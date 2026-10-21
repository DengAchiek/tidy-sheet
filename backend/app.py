"""Private service called by the authenticated TidySheet Worker, not browsers."""
import json
import os
import secrets
import threading
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from cleaning import clean_dataset
from charts import make_charts

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BODY = 6 * 1024 * 1024
MAX_RESPONSE = 24 * 1024 * 1024
processing = threading.BoundedSemaphore(1)


def response(body, status=200):
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.middleware("http")
async def authenticate(request, call_next):
    secret = os.environ.get("CLEANING_API_TOKEN", "")
    if len(secret) < 32:
        return response({"message": "Python cleaning is not configured."}, 503)
    if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + secret):
        return response({"message": "Unauthorized."}, 401)
    return await call_next(request)


@app.get("/health")
async def health():
    return response({"status": "ready", "engine": "pandas-numpy-seaborn", "maxRows": 50000, "maxCells": 100000, "maxRequestBytes": MAX_BODY})


def process(payload):
    if not processing.acquire(blocking=False):
        return {"message": "This cleaning server is busy. Try again shortly."}, 429
    try:
        start = time.monotonic()
        original, cleaned, result, before = clean_dataset(payload)
        charts = make_charts(original, cleaned, result, before, payload["config"])
        body = {"result": result, "charts": charts, "engine": "pandas-numpy-seaborn", "durationMs": round((time.monotonic() - start) * 1000)}
        if len(json.dumps(body, allow_nan=False, ensure_ascii=False).encode()) > MAX_RESPONSE:
            return {"message": "The result is too large. Split the dataset into smaller files."}, 413
        return body, 200
    except (ValueError, TypeError, KeyError, OverflowError):
        # Do not echo values, column names or parser exception text into logs/errors.
        return {"message": "Check the dataset and cleaning rules. Server limits: 50,000 rows, 100,000 cells and a 6 MB request."}, 400
    except Exception:
        return {"message": "Python cleaning failed. Try again or use on-device cleaning."}, 500
    finally:
        processing.release()


@app.post("/clean")
async def clean(request: Request):
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        return response({"message": "Send JSON data."}, 415)
    size = request.headers.get("content-length", "")
    if size and (not size.isdigit() or int(size) > MAX_BODY):
        return response({"message": "Server cleaning accepts up to 6 MB of worksheet values and rules."}, 413)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BODY:
            return response({"message": "Server cleaning accepts up to 6 MB of worksheet values and rules."}, 413)
        data.extend(chunk)
    try:
        payload = json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        return response({"message": "Provide valid JSON data."}, 400)
    body, status = await run_in_threadpool(process, payload)
    return response(body, status)

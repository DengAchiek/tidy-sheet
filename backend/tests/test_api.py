import base64
import os
from fastapi.testclient import TestClient
from test_cleaning import payload
from app import app, processing

TOKEN='test-only-service-token-that-is-not-used-in-production'
HEADERS={'Authorization':'Bearer '+TOKEN}


def client(monkeypatch):
    monkeypatch.setenv('CLEANING_API_TOKEN',TOKEN)
    return TestClient(app)


def test_service_authentication_and_private_responses(monkeypatch):
    c=client(monkeypatch)
    assert c.get('/health').status_code==401
    assert c.post('/clean',json={}).status_code==401
    r=c.get('/health',headers=HEADERS)
    assert r.status_code==200 and r.json()['engine']=='pandas-numpy-seaborn'
    assert r.headers['cache-control']=='private, no-store'
    monkeypatch.delenv('CLEANING_API_TOKEN')
    assert c.get('/health',headers=HEADERS).status_code==503


def test_cleaning_returns_real_charts_and_inspectable_data(monkeypatch):
    c=client(monkeypatch)
    p=payload(['ID','Amount','Empty'],[[f'{i:03}',str(i),''] for i in range(1,9)]+[['009','1000',''],['010','NaN','']],['text','number','text'])
    r=c.post('/clean',headers=HEADERS,json=p)
    assert r.status_code==200,r.text
    body=r.json()
    assert body['result']['stats']['emptyColumns']==1
    assert '1000' in [row[1] for row in body['result']['rows']]
    assert [ch['id'] for ch in body['charts']]==['row-outcomes','missing-values','numeric-distributions']
    for ch in body['charts']:
        assert base64.b64decode(ch['image'].split(',')[1]).startswith(b'\x89PNG\r\n\x1a\n')
        assert ch['data']
    missing=next(row for row in body['charts'][1]['data'] if row['column']=='Empty')
    assert missing['afterPercent'] is None and missing['status']=='Removed empty column'
    assert not r.headers.get('access-control-allow-origin')


def test_bad_requests_do_not_echo_dataset_values(monkeypatch):
    c=client(monkeypatch)
    r=c.post('/clean',headers=HEADERS,json={'private-secret-value':True})
    assert r.status_code==400 and 'private-secret-value' not in r.text
    assert c.post('/clean',headers={**HEADERS,'Content-Type':'application/json'},content='{"x":NaN}').status_code==400
    assert c.post('/clean',headers={**HEADERS,'Content-Length':str(7*1024*1024),'Content-Type':'application/json'},content='{}').status_code==413
    assert c.post('/clean',headers=HEADERS,content='text').status_code==415
    assert c.post('/clean',headers=HEADERS,json={'model':None,'config':{}}).status_code==400


def test_bounded_concurrency_and_empty_output_charts(monkeypatch):
    c=client(monkeypatch)
    processing.acquire()
    try:assert c.post('/clean',headers=HEADERS,json=payload(['A'],[['x']])).status_code==429
    finally:processing.release()
    r=c.post('/clean',headers=HEADERS,json=payload(['A'],[['null']]))
    assert r.status_code==200,r.text
    assert r.json()['result']['rows']==[] and len(r.json()['charts'])==2


def test_huge_numeric_values_are_retained_without_breaking_chart_arithmetic(monkeypatch):
    c=client(monkeypatch)
    huge='9'*309
    p=payload(['ID','Amount'],[[str(i),str(i)] for i in range(1,9)]+[['9',huge]],['text','number'])
    r=c.post('/clean',headers=HEADERS,json=p)
    assert r.status_code==200,r.text
    body=r.json()
    assert body['result']['rows'][-1][1]==huge
    chart=next(ch for ch in body['charts'] if ch['id']=='numeric-distributions')
    assert chart['data'][0]['included']==8 and chart['data'][0]['excluded']==1

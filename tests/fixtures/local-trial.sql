-- Local browser QA only. Never include this fixture in hosted migrations.
UPDATE accounts SET trial_ends=(unixepoch('now')+3600)*1000 WHERE id='local_seedy';

-- Custom SQL migration file, put your code below! --
INSERT INTO users (sub, name)
SELECT 'local:owner', 'Jesus Marcos'
WHERE EXISTS (SELECT 1 FROM ledgers);

--> statement-breakpoint

INSERT INTO ledger_members (user_id, ledger_id, role)
SELECT (SELECT id FROM users WHERE sub = 'local:owner'), ledgers.id, 'owner'
FROM ledgers;
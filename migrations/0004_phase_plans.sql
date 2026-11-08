-- A Phase's Plan: the vault path of the document describing its intended
-- training, e.g. Programs/2026-12-spring-half/Plans/base.md. NULL until one is
-- linked. The document itself lives in R2 and may be written later.

ALTER TABLE phases ADD COLUMN plan_path TEXT;

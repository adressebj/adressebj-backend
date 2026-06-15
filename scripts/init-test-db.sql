-- Crée la base de test isolée au premier démarrage du conteneur Postgres.
-- Les migrations y sont appliquées via :
--   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/adressebj_test npx prisma migrate deploy
CREATE DATABASE adressebj_test;

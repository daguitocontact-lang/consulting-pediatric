-- ═══════════════════════════════════════════════════════════════════════════
--  Accent- and case-blind folding for the listing's name column
-- ═══════════════════════════════════════════════════════════════════════════
-- The doctor types "maria" and the patient is "María"; "sofia" for "Sofía".
-- `lower(...) LIKE` is accent-SENSITIVE, so the search found neither — the
-- legacy app had the same hole and it only looked like it worked because the
-- seeded names happen to be unaccented. In Colombia the accent is the exception
-- when typing, not the rule.
--
-- Sorting had the second half of the same problem: the database's collation put
-- "maría camila" AFTER "Sofía Rojas", because uppercase sorts before lowercase
-- byte-wise. A listing that orders by a name has to order by the name as it is
-- READ, not as it is encoded.
--
-- `unaccent` would be the textbook answer and is deliberately NOT used. It is
-- an EXTENSION, and creating one needs rights the API's role does not have on
-- RDS. Migrations run on every boot in prod: a `CREATE EXTENSION` the grant
-- refuses would fail the step, and then every search would 500 on a function
-- that does not exist — the panel's main screen, broken by a nicety.
--
-- `translate` is plain SQL, needs no privileges and no extension, and covers
-- Spanish completely. IMMUTABLE (unlike `unaccent`, which is only STABLE), so
-- it can carry the functional index below.
--
-- Idempotent: CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION pediatric_fold(value text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$
  -- Both arguments must be the same length in CHARACTERS; the accented set is
  -- listed uppercase then lowercase so the mapping survives either casing, and
  -- lower() finishes the job.
  SELECT lower(
    translate(
      value,
      'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc'
    )
  )
$$;

-- The listing searches and sorts on the folded name, so that is what is
-- indexed. Replaces the plain lower() index from 0002, which no query uses any
-- more.
DROP INDEX IF EXISTS consultations_org_name;
CREATE INDEX IF NOT EXISTS consultations_org_name_folded
  ON consultations (org_id, pediatric_fold(COALESCE(name, patient_name)));

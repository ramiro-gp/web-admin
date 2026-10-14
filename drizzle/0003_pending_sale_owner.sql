-- A tracked original sale is commercial history even before its payment.
-- Changing the owner would move that pending debt to another client.
CREATE OR REPLACE FUNCTION guard_website_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id AND (
    OLD.sale_payment_tracked
    OR EXISTS (SELECT 1 FROM plans WHERE website_id = OLD.id)
    OR EXISTS (SELECT 1 FROM additional_works WHERE website_id = OLD.id)
    OR OLD.sale_paid_on IS NOT NULL) THEN
    RAISE EXCEPTION 'Un sitio con historial conserva su cliente';
  END IF;
  RETURN NEW;
END $$;

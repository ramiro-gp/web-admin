ALTER TABLE "billing_periods" ALTER COLUMN "price_id" DROP NOT NULL;
--> statement-breakpoint
-- An explicit historical import has an amount and note supplied by the owner.
-- It does not invent a price version or change the managed billing cutoff.
CREATE OR REPLACE FUNCTION guard_billing_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract plans%ROWTYPE; tariff plan_prices%ROWTYPE; months_from_start integer; chosen_price uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Los períodos se conservan como historial'; END IF;
  SELECT * INTO STRICT contract FROM plans WHERE id = NEW.plan_id;
  months_from_start := (extract(year FROM NEW.starts_on)::integer - extract(year FROM contract.billing_start)::integer) * 12
    + extract(month FROM NEW.starts_on)::integer - extract(month FROM contract.billing_start)::integer;
  IF months_from_start % contract.frequency_months <> 0
    OR NEW.starts_on <> billing_boundary(contract.billing_start, contract.anchor_day, months_from_start)
    OR NEW.ends_on <> billing_boundary(contract.billing_start, contract.anchor_day, months_from_start + contract.frequency_months)
    OR (contract.ended_on IS NOT NULL AND NEW.ends_on > contract.ended_on) THEN
    RAISE EXCEPTION 'El período no coincide con el calendario del plan';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.plan_id, NEW.price_id, NEW.starts_on, NEW.ends_on, NEW.due_on)
    IS DISTINCT FROM (OLD.plan_id, OLD.price_id, OLD.starts_on, OLD.ends_on, OLD.due_on) THEN
    RAISE EXCEPTION 'El calendario y el precio aplicado de un período son históricos';
  END IF;
  IF NEW.price_id IS NULL THEN
    IF months_from_start >= 0 OR nullif(trim(NEW.notes), '') IS NULL THEN
      RAISE EXCEPTION 'Un período histórico sin precio debe ser anterior al corte y tener una nota';
    END IF;
    RETURN NEW;
  END IF;
  IF months_from_start < 0 THEN
    RAISE EXCEPTION 'Los períodos anteriores al corte se cargan explícitamente sin inventar precios';
  END IF;
  SELECT * INTO STRICT tariff FROM plan_prices WHERE id = NEW.price_id;
  IF tariff.plan_id <> NEW.plan_id OR tariff.effective_from > NEW.starts_on THEN
    RAISE EXCEPTION 'El precio no corresponde al plan y período';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO chosen_price FROM plan_prices WHERE plan_id = NEW.plan_id AND effective_from <= NEW.starts_on ORDER BY effective_from DESC LIMIT 1;
    IF chosen_price IS DISTINCT FROM NEW.price_id THEN RAISE EXCEPTION 'El período debe usar el precio vigente en su inicio'; END IF;
  END IF;
  IF NEW.expected_amount_minor <> tariff.amount_minor AND nullif(trim(NEW.notes), '') IS NULL THEN
    RAISE EXCEPTION 'Un ajuste de importe requiere una nota';
  END IF;
  RETURN NEW;
END $$;

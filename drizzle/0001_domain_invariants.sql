-- Calendar boundaries always come from the original month and anchor, never
-- from a previous date shortened by February or another short month.
CREATE FUNCTION billing_boundary(base_date date, anchor integer, month_offset integer)
RETURNS date LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (target_month + (least(anchor, extract(day FROM target_month + interval '1 month - 1 day')::integer) - 1))::date
  FROM (SELECT (date_trunc('month', base_date)::date + make_interval(months => month_offset))::date AS target_month) AS calendar;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_plan_calendar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE months_from_start integer;
BEGIN
  IF NEW.billing_start <> billing_boundary(NEW.billing_start, NEW.anchor_day, 0) THEN
    RAISE EXCEPTION 'El primer período no coincide con el día ancla';
  END IF;
  IF NEW.ended_on IS NOT NULL THEN
    months_from_start := (extract(year FROM NEW.ended_on)::integer - extract(year FROM NEW.billing_start)::integer) * 12
      + extract(month FROM NEW.ended_on)::integer - extract(month FROM NEW.billing_start)::integer;
    IF months_from_start % NEW.frequency_months <> 0 OR NEW.ended_on <> billing_boundary(NEW.billing_start, NEW.anchor_day, months_from_start) THEN
      RAISE EXCEPTION 'La finalización debe coincidir con un límite de período';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM plans p WHERE p.website_id = NEW.website_id AND p.id <> NEW.id
    AND coalesce(p.started_on, p.billing_start) < coalesce(NEW.ended_on, 'infinity'::date)
    AND coalesce(NEW.started_on, NEW.billing_start) < coalesce(p.ended_on, 'infinity'::date)) THEN
    RAISE EXCEPTION 'El sitio ya tiene un plan vigente en ese intervalo';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.website_id IS DISTINCT FROM OLD.website_id AND EXISTS (SELECT 1 FROM plan_domains WHERE plan_id = OLD.id) THEN
      RAISE EXCEPTION 'Un plan con dominios incluidos conserva su sitio histórico';
    END IF;
    IF EXISTS (SELECT 1 FROM billing_periods WHERE plan_id = OLD.id) AND
      (NEW.website_id, NEW.frequency_months, NEW.currency, NEW.billing_start, NEW.anchor_day)
      IS DISTINCT FROM (OLD.website_id, OLD.frequency_months, OLD.currency, OLD.billing_start, OLD.anchor_day) THEN
      RAISE EXCEPTION 'El calendario y la moneda de un plan con períodos son históricos';
    END IF;
    IF NEW.ended_on IS NOT NULL AND EXISTS (SELECT 1 FROM billing_periods WHERE plan_id = NEW.id AND ends_on > NEW.ended_on) THEN
      RAISE EXCEPTION 'La finalización no puede recortar períodos existentes';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER plans_calendar BEFORE INSERT OR UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION guard_plan_calendar();
--> statement-breakpoint
CREATE FUNCTION guard_billing_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE contract plans%ROWTYPE; tariff plan_prices%ROWTYPE; months_from_start integer; chosen_price uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Los períodos se conservan como historial'; END IF;
  SELECT * INTO STRICT contract FROM plans WHERE id = NEW.plan_id;
  SELECT * INTO STRICT tariff FROM plan_prices WHERE id = NEW.price_id;
  months_from_start := (extract(year FROM NEW.starts_on)::integer - extract(year FROM contract.billing_start)::integer) * 12
    + extract(month FROM NEW.starts_on)::integer - extract(month FROM contract.billing_start)::integer;
  IF months_from_start < 0 OR months_from_start % contract.frequency_months <> 0
    OR NEW.starts_on <> billing_boundary(contract.billing_start, contract.anchor_day, months_from_start)
    OR NEW.ends_on <> billing_boundary(contract.billing_start, contract.anchor_day, months_from_start + contract.frequency_months)
    OR (contract.ended_on IS NOT NULL AND NEW.ends_on > contract.ended_on) THEN
    RAISE EXCEPTION 'El período no coincide con el calendario del plan';
  END IF;
  IF tariff.plan_id <> NEW.plan_id OR tariff.effective_from > NEW.starts_on THEN
    RAISE EXCEPTION 'El precio no corresponde al plan y período';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO chosen_price FROM plan_prices WHERE plan_id = NEW.plan_id AND effective_from <= NEW.starts_on ORDER BY effective_from DESC LIMIT 1;
    IF chosen_price IS DISTINCT FROM NEW.price_id THEN RAISE EXCEPTION 'El período debe usar el precio vigente en su inicio'; END IF;
  ELSE
    IF (NEW.plan_id, NEW.price_id, NEW.starts_on, NEW.ends_on, NEW.due_on)
      IS DISTINCT FROM (OLD.plan_id, OLD.price_id, OLD.starts_on, OLD.ends_on, OLD.due_on) THEN
      RAISE EXCEPTION 'El calendario y el precio aplicado de un período son históricos';
    END IF;
  END IF;
  IF NEW.expected_amount_minor <> tariff.amount_minor AND nullif(trim(NEW.notes), '') IS NULL THEN
    RAISE EXCEPTION 'Un ajuste de importe requiere una nota';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER billing_periods_history BEFORE INSERT OR UPDATE OR DELETE ON billing_periods FOR EACH ROW EXECUTE FUNCTION guard_billing_period();
--> statement-breakpoint
CREATE FUNCTION guard_used_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM billing_periods WHERE plan_id = NEW.plan_id AND starts_on >= NEW.effective_from) THEN
      RAISE EXCEPTION 'Un precio nuevo no puede alterar períodos emitidos';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM billing_periods WHERE price_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un precio utilizado se conserva como historial'; END IF;
    IF (NEW.plan_id, NEW.amount_minor, NEW.effective_from) IS DISTINCT FROM (OLD.plan_id, OLD.amount_minor, OLD.effective_from) THEN
      RAISE EXCEPTION 'Un precio utilizado no se sobrescribe';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER plan_prices_history BEFORE INSERT OR UPDATE OR DELETE ON plan_prices FOR EACH ROW EXECUTE FUNCTION guard_used_price();
--> statement-breakpoint
CREATE FUNCTION guard_domain_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plans p JOIN domains d ON d.website_id = p.website_id WHERE p.id = NEW.plan_id AND d.id = NEW.domain_id) THEN
    RAISE EXCEPTION 'El dominio y el plan deben pertenecer al mismo sitio';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER plan_domains_same_site BEFORE INSERT OR UPDATE ON plan_domains FOR EACH ROW EXECUTE FUNCTION guard_domain_membership();
--> statement-breakpoint
CREATE FUNCTION guard_domain_site() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.website_id IS DISTINCT FROM OLD.website_id AND EXISTS (SELECT 1 FROM plan_domains WHERE domain_id = OLD.id) THEN
    RAISE EXCEPTION 'Un dominio incluido conserva su sitio histórico';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER domains_site_history BEFORE UPDATE ON domains FOR EACH ROW EXECUTE FUNCTION guard_domain_site();
--> statement-breakpoint
CREATE FUNCTION guard_website_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id AND (
    EXISTS (SELECT 1 FROM plans WHERE website_id = OLD.id)
    OR EXISTS (SELECT 1 FROM additional_works WHERE website_id = OLD.id)
    OR OLD.sale_paid_on IS NOT NULL) THEN
    RAISE EXCEPTION 'Un sitio con historial conserva su cliente';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER websites_owner_history BEFORE UPDATE ON websites FOR EACH ROW EXECUTE FUNCTION guard_website_owner();

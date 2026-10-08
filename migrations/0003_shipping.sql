-- Shipping types per listing.
--
-- shipping_methods: the carriers/services the farm ships by. price is in
-- dollars; NULL means "price not set": the method is never offered at checkout
-- and the farm desk shows it as "Needs price". Farm pickup is not a row here;
-- it is always offered and free (orders.method = 'pickup').
create table if not exists shipping_methods (
  slug text primary key,
  carrier text not null,
  name text not null,
  price numeric check (price is null or price >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text not null default ''
);

-- Only USPS Priority Mail gets a price: the farm's existing egg flat rate
-- (shop_settings.ship_eggs), so egg shipping keeps working as before. Every
-- other price waits for the farm.
insert into shipping_methods (slug, carrier, name, price, sort_order, notes) values
  ('usps-priority', 'USPS', 'USPS Priority Mail',
    coalesce((select ship_eggs from shop_settings where id = 1), 18), 10,
    'Started at the previous egg shipping flat rate.'),
  ('usps-priority-express', 'USPS', 'USPS Priority Mail Express', null, 20,
    'Adult birds; optional upgrade for chicks.'),
  ('ups-ground', 'UPS', 'UPS Ground', null, 30, ''),
  ('ups-3-day', 'UPS', 'UPS 3 Day Select', null, 40, ''),
  ('ups-2-day', 'UPS', 'UPS 2nd Day Air', null, 50, ''),
  ('ups-next-day', 'UPS', 'UPS Next Day Air', null, 60, '')
on conflict (slug) do nothing;

-- Listing category: hatching eggs, chicks, or adult birds. kind stays for
-- compatibility (eggs | birds) and must agree with category.
alter table products add column if not exists category text;

update products p set category = case
  when p.kind = 'eggs' then 'eggs'
  when exists (select 1 from variants v where v.product_id = p.id)
    and not exists (select 1 from variants v where v.product_id = p.id and v.label !~* 'chick')
    then 'chicks'
  else 'adult'
end
where p.category is null;

alter table products alter column category set not null;
alter table products drop constraint if exists products_category_check;
alter table products add constraint products_category_check
  check (category in ('eggs', 'chicks', 'adult') and ((category = 'eggs') = (kind = 'eggs')));

-- Which methods each listing can ship by.
create table if not exists product_shipping_methods (
  product_id integer not null references products (id) on delete cascade,
  method_slug text not null references shipping_methods (slug) on update cascade on delete cascade,
  primary key (product_id, method_slug)
);

insert into product_shipping_methods (product_id, method_slug)
select p.id, d.method_slug
from products p
join (values
  ('adult', 'usps-priority-express'),
  ('chicks', 'usps-priority'),
  ('chicks', 'usps-priority-express'),
  ('eggs', 'usps-priority'),
  ('eggs', 'ups-ground'),
  ('eggs', 'ups-3-day'),
  ('eggs', 'ups-2-day'),
  ('eggs', 'ups-next-day')
) as d (category, method_slug) on d.category = p.category
on conflict do nothing;

-- The method an order ships by, snapshotted at order time (slug + name; the
-- price is orders.shipping). NULL for pickup and for orders placed before
-- shipping types existed (including the imported GoDaddy/eBay history).
alter table orders add column if not exists shipping_method text;
alter table orders add column if not exists shipping_method_name text;

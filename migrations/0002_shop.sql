create table if not exists shop_owner (
  id integer primary key check (id = 1),
  user_id text not null
);

create table if not exists shop_settings (
  id integer primary key check (id = 1),
  ship_eggs numeric not null default 18,
  tax_rate numeric not null default 0
);

insert into shop_settings (id, ship_eggs, tax_rate)
values (1, 18, 0)
on conflict (id) do nothing;

create table if not exists products (
  id serial primary key,
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('eggs', 'birds')),
  image text not null,
  description text not null default ''
);

create table if not exists variants (
  id serial primary key,
  product_id integer not null references products (id) on delete cascade,
  sku text not null,
  label text not null,
  price numeric not null,
  compare_price numeric,
  stock integer
);

create table if not exists orders (
  id text primary key,
  owner_user_id text not null,
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null default '',
  method text not null check (method in ('pickup', 'ship')),
  address text not null default '',
  status text not null,
  note text not null default '',
  subtotal numeric not null,
  shipping numeric not null,
  tax numeric not null,
  total numeric not null,
  history text not null default '[]'
);

create table if not exists order_items (
  id serial primary key,
  order_id text not null references orders (id) on delete cascade,
  slug text not null,
  variant_id integer,
  name text not null,
  label text not null,
  price numeric not null,
  image text not null default '',
  qty integer not null,
  sku text not null default '',
  kind text not null
);

create index if not exists orders_owner_idx on orders (owner_user_id);
create index if not exists order_items_order_idx on order_items (order_id);

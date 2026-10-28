-- POS Counter optional module, toggled per company by the developer.
insert into public.modules(key,name,description,default_price,is_active)
values ('pos_counter','POS Counter','Full-screen retail counter: barcode scanning, cash/QR/credit bills, 80mm receipts',0,true)
on conflict(key) do update set name=excluded.name, description=excluded.description;

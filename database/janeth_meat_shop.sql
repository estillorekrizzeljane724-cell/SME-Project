CREATE DATABASE IF NOT EXISTS janeth_meat_shop
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE janeth_meat_shop;

-- =========================================================
-- CUSTOMERS
-- =========================================================

CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    customer_type ENUM('Retail','Wholesale') DEFAULT 'Retail',
    credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


-- =========================================================
-- SUPPLIERS
-- =========================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    supplier_name VARCHAR(100) NOT NULL,
    contact_person VARCHAR(100),
    phone_number VARCHAR(20),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


-- =========================================================
-- PRODUCTS
-- =========================================================

CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,

    meat_cut VARCHAR(100) NOT NULL,

    category ENUM(
        'Pork',
        'Beef',
        'Chicken',
        'Processed',
        'Offal'
    ) NOT NULL,

    -- What the shop pays the supplier
    cost_per_kilo DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    -- What the customer pays
    price_per_kilo DECIMAL(10,2) NOT NULL,

    stock_kilos DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    reorder_level_kilos DECIMAL(10,2) NOT NULL DEFAULT 5.00,

    supplier_id INT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_products_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;


-- =========================================================
-- INVENTORY LOGS
-- =========================================================

CREATE TABLE IF NOT EXISTS inventory_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,

    supplier_id INT NULL,

    added_kilos DECIMAL(10,2) NOT NULL,

    cost_per_kilo DECIMAL(10,2) NOT NULL,

    log_type ENUM(
        'Initial Stock',
        'Restock',
        'Spoilage',
        'Adjustment'
    ) DEFAULT 'Restock',

    notes VARCHAR(255),

    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_inventory_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_inventory_supplier
        FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;


-- =========================================================
-- SALES
-- =========================================================

CREATE TABLE IF NOT EXISTS sales (
    id INT AUTO_INCREMENT PRIMARY KEY,

    customer_id INT NULL,

    total_amount DECIMAL(10,2) NOT NULL,

    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    change_given DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    payment_method ENUM(
        'Cash',
        'GCash',
        'Credit'
    ) DEFAULT 'Cash',

    payment_status ENUM(
        'Paid',
        'Partial',
        'Unpaid'
    ) DEFAULT 'Paid',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sales_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;


-- =========================================================
-- SALES ITEMS
-- =========================================================

CREATE TABLE IF NOT EXISTS sales_items (
    id INT AUTO_INCREMENT PRIMARY KEY,

    sale_id INT NOT NULL,

    product_id INT NOT NULL,

    weight_kilos DECIMAL(10,2) NOT NULL,

    -- Selling price at time of sale
    unit_price DECIMAL(10,2) NOT NULL,

    -- Cost at time of sale
    unit_cost DECIMAL(10,2) NOT NULL,

    subtotal DECIMAL(10,2) NOT NULL,

    CONSTRAINT fk_sales_items_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_sales_items_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;


-- =========================================================
-- CREDIT PAYMENTS
-- =========================================================

CREATE TABLE IF NOT EXISTS credit_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,

    customer_id INT NOT NULL,

    sale_id INT NULL,

    amount_paid DECIMAL(10,2) NOT NULL,

    payment_method ENUM(
        'Cash',
        'GCash'
    ) DEFAULT 'Cash',

    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_credit_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_credit_sale
        FOREIGN KEY (sale_id)
        REFERENCES sales(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;


-- =========================================================
-- SEED SUPPLIERS
-- =========================================================

INSERT INTO suppliers
(supplier_name, contact_person, phone_number, address)
SELECT
'Cebu Livestock Farms',
'Juan Dela Cruz',
'09171234567',
'Carcar City, Cebu'
WHERE NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE supplier_name = 'Cebu Livestock Farms'
);


INSERT INTO suppliers
(supplier_name, contact_person, phone_number, address)
SELECT
'Visayas Meat Importers',
'Maria Santos',
'09189876543',
'Mandaue City, Cebu'
WHERE NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE supplier_name = 'Visayas Meat Importers'
);


INSERT INTO suppliers
(supplier_name, contact_person, phone_number, address)
SELECT
'San Miguel Foods',
'Carlos Reyes',
'09228889999',
'Cebu City, Cebu'
WHERE NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE supplier_name = 'San Miguel Foods'
);


-- =========================================================
-- SEED CUSTOMERS
-- =========================================================

INSERT INTO customers
(full_name, phone_number, customer_type, credit_balance, address)
SELECT
'Walk-In Customer',
'N/A',
'Retail',
0.00,
''
WHERE NOT EXISTS (
    SELECT 1 FROM customers
    WHERE full_name = 'Walk-In Customer'
);


INSERT INTO customers
(full_name, phone_number, customer_type, credit_balance, address)
SELECT
'Aling Nena Eatery',
'09223334444',
'Wholesale',
1200.00,
''
WHERE NOT EXISTS (
    SELECT 1 FROM customers
    WHERE full_name = 'Aling Nena Eatery'
);


INSERT INTO customers
(full_name, phone_number, customer_type, credit_balance, address)
SELECT
'Krizzel Jane',
'09190001111',
'Retail',
0.00,
''
WHERE NOT EXISTS (
    SELECT 1 FROM customers
    WHERE full_name = 'Krizzel Jane'
);


-- =========================================================
-- SEED PRODUCTS
-- =========================================================

INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Liempo',
'Pork',
285.00,
330.00,
30.00,
5.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Liempo'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Kasim',
'Pork',
260.00,
300.00,
25.00,
5.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Kasim'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Porkchop',
'Pork',
275.00,
290.00,
20.00,
5.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Porkchop'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Pigfoot (Pata)',
'Pork',
220.00,
260.00,
15.00,
3.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Pigfoot (Pata)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Ground Meat (Giniling)',
'Pork',
240.00,
280.00,
18.00,
4.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Pork Ground Meat (Giniling)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Beef Lean Meat',
'Beef',
360.00,
420.00,
15.00,
3.00,
2
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Beef Lean Meat'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Beef Ribs',
'Beef',
320.00,
380.00,
12.00,
3.00,
2
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Beef Ribs'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Beef Shank (Bulalo)',
'Beef',
340.00,
400.00,
10.00,
2.00,
2
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Beef Shank (Bulalo)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Beef Ground Meat',
'Beef',
330.00,
390.00,
14.00,
3.00,
2
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Beef Ground Meat'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Whole Dressed Chicken',
'Chicken',
178.00,
210.00,
40.00,
10.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Whole Dressed Chicken'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Breast (Boneless)',
'Chicken',
205.00,
240.00,
25.00,
5.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Chicken Breast (Boneless)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Drumstick',
'Chicken',
185.00,
220.00,
20.00,
5.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Drumstick'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Wings',
'Chicken',
195.00,
230.00,
18.00,
5.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Wings'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Head (Helmet)',
'Chicken',
85.00,
110.00,
15.00,
3.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Head (Helmet)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Feet (Adidas)',
'Chicken',
100.00,
130.00,
20.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Feet (Adidas)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Tender Juicy Hotdog (Jumbo)',
'Processed',
180.00,
220.00,
35.00,
8.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Tender Juicy Hotdog (Jumbo)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Sweet Ham Slices',
'Processed',
215.00,
260.00,
15.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Sweet Ham Slices'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Jumbo Meatballs',
'Processed',
195.00,
240.00,
20.00,
5.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Jumbo Meatballs'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Tocino',
'Processed',
205.00,
250.00,
15.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Tocino'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Tocino',
'Processed',
195.00,
240.00,
15.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Tocino'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chorizo de Cebu (Special)',
'Processed',
185.00,
230.00,
30.00,
6.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Chorizo de Cebu (Special)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Smoked German Sausages',
'Processed',
255.00,
310.00,
12.00,
3.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Smoked German Sausages'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Skinless Longganisa',
'Processed',
185.00,
230.00,
18.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Skinless Longganisa'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Intestines (Isaw)',
'Offal',
105.00,
140.00,
15.00,
4.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Chicken Intestines (Isaw)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Liver & Gizzard',
'Offal',
135.00,
180.00,
12.00,
3.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Chicken Liver & Gizzard'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Liver',
'Offal',
145.00,
200.00,
10.00,
2.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Liver'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Intestines (Chicharon Bulaklak)',
'Offal',
140.00,
190.00,
12.00,
3.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products
    WHERE meat_cut='Pork Intestines (Chicharon Bulaklak)'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Blood (Betamax)',
'Offal',
55.00,
80.00,
10.00,
2.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Blood (Betamax)'
);


-- =========================================================
-- LUMPIA
-- =========================================================

INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Pork Lumpia',
'Processed',
175.00,
220.00,
20.00,
5.00,
1
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Pork Lumpia'
);


INSERT INTO products
(meat_cut, category, cost_per_kilo, price_per_kilo,
 stock_kilos, reorder_level_kilos, supplier_id)
SELECT
'Chicken Lumpia',
'Processed',
165.00,
210.00,
20.00,
5.00,
3
WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE meat_cut='Chicken Lumpia'
);


-- =========================================================
-- INITIAL INVENTORY LOGS
-- =========================================================

INSERT INTO inventory_logs
(product_id, supplier_id, added_kilos, cost_per_kilo, log_type, notes)
SELECT
p.id,
p.supplier_id,
p.stock_kilos,
p.cost_per_kilo,
'Initial Stock',
'Initial inventory'
FROM products p
WHERE NOT EXISTS (
    SELECT 1
    FROM inventory_logs il
    WHERE il.product_id = p.id
      AND il.log_type = 'Initial Stock'
);


-- =========================================================
-- CHECK DATABASE
-- =========================================================

SELECT DATABASE() AS current_database;

SHOW TABLES;

SELECT
    id,
    meat_cut,
    category,
    cost_per_kilo,
    price_per_kilo,
    (price_per_kilo - cost_per_kilo) AS profit_per_kilo,
    stock_kilos
FROM products
ORDER BY category, meat_cut;
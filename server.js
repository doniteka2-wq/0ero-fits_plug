const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const MOMO_NUMBER = process.env.MOMO_NUMBER || '0795828020';
const MOMO_NAME = process.env.MOMO_NAME || "Muhizi Michel";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'doniteka2gmail.com@gmail.com';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'super-secure-admin-secret-key-xyz';
const DB_FILE = path.join(__dirname, 'database_v24.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- DB helpers ----------
function getDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = { users: [], activities: [], products: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            return initialData;
        }
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        parsed.users = parsed.users || [];
        parsed.activities = parsed.activities || [];
        parsed.products = parsed.products || [];
        parsed.orders = parsed.orders || [];
        return parsed;
    } catch (err) {
        console.error('❌ database_v24.json is corrupted:', err.message);
        process.exit(1);
    }
}

function saveDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- Multer config ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/image\/(jpeg|png|webp|gif)/.test(file.mimetype)) cb(null, true);
        else cb(new Error('Only image files are allowed.'));
    }
});

// ---------- Admin credentials ----------
// After first run, replace this hash with the output of:
//   node -e "console.log(require('bcryptjs').hashSync('admin1234', 10))"
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'admin1234'
};
// ---------- Email helper (stub — replace with real Nodemailer later) ----------
async function sendEmail({ to, subject, html }) {
    console.log('📧 [Email stub] To:', to, '| Subject:', subject);
    return true;
}

// ---------- Root ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- User register ----------
app.post('/api/orders', verifyCustomerToken, async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'All fields are required.' });

        const db = getDb();
        if (db.users.some(u => u.email === email)) return res.status(400).json({ message: 'Email already registered.' });

        const nextId = db.users.length ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
        const generatedId = "USR" + Math.floor(100 + Math.random() * 900);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        db.users.push({
            id: nextId,
            userId: generatedId,
            name,
            email,
            passwordHash: hashedPassword,
            status: "Active"
        });

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: name,
            action: "Registered a new account",
            status: "Complete"
        });

        saveDb(db);
        const form = document.getElementById('productForm');
        res.status(201).json({ success: true, message: 'Account configured successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server registration failure.' });
    }
});

// ---------- User login ----------
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;
    const db = getDb();
    const user = db.users.find(u => u.email === email);

    if (!user || !user.passwordHash) return res.status(401).json({ message: 'Invalid credentials.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials.' });

    const token = jwt.sign({ id: user.userId, role: 'customer' }, JWT_SECRET, { expiresIn: '6h' });
    res.json({ success: true, token });
});
app.post('/api/users/reset-password', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Email and new password are required.' });
        if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

        const db = getDb();
        const user = db.users.find(u => u.email === email);
        if (!user) return res.status(404).json({ message: 'No account found with that email.' });

        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password, salt);

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: user.name,
            action: 'Reset account password',
            status: 'Complete'
        });

        saveDb(db);
        res.json({ success: true, message: 'Password updated.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ---------- Admin auth middleware ----------
const verifyAdminToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized session.' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Session timed out or invalid.' });
    }
};
const verifyCustomerToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Please log in to place an order.' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Session expired. Please log in again.' });
    }
};
// ---------- Admin login ----------
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    console.log('--- Admin login attempt ---');
    console.log('username received:', JSON.stringify(username));
    console.log('password length received:', password ? password.length : 0);
    console.log('expected username:', JSON.stringify(ADMIN_CREDENTIALS.username));

    if (username !== ADMIN_CREDENTIALS.username) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

   const isPasswordValid = password === ADMIN_CREDENTIALS.password;
    console.log('password matches stored hash:', isPasswordValid);

    if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ success: true, token });
});

// ---------- Admin metrics ----------
app.get('/api/admin/metrics', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json({ totalSales: 12450, activeUsers: db.users.length, pendingOrders: 18 });
});

// ---------- Admin activities ----------
app.get('/api/admin/activities', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.activities.slice(0, 10));
});

// ---------- Admin users ----------
app.get('/api/admin/users', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.users.map(({ passwordHash, ...rest }) => rest));
});

// ---------- Admin delete user ----------
app.delete('/api/admin/users/:id', verifyAdminToken, (req, res) => {
    const db = getDb();
    const targetId = req.params.id;
    const initialLength = db.users.length;
    db.users = db.users.filter(u => u.userId !== targetId);

    if (db.users.length < initialLength) {
        saveDb(db);
        return res.json({ success: true, message: 'User permanently deleted.' });
    }
    res.status(404).json({ message: 'User not found.' });
});

// ---------- Public products ----------
app.get('/api/products', (req, res) => {
    const db = getDb();
    res.json(db.products || []);
});

// ---------- Admin upload product ----------
app.post('/api/admin-products', verifyAdminToken, upload.single('image'), (req, res) => {
    try {
        const { name, price, category, description } = req.body;
        if (!name || !price) return res.status(400).json({ message: 'Name and price are required.' });

        const db = getDb();

        const nextId = db.products.length ? Math.max(...db.products.map(p => p.id)) + 1 : 1;
        const generatedId = "PRD" + Math.floor(100 + Math.random() * 900);
        const imagePath = req.file ? '/uploads/' + req.file.filename : null;

        const product = {
            id: nextId,
            productId: generatedId,
            name,
            price: parseFloat(price),
            category: category || 'Uncategorized',
            description: description || '',
            image: imagePath
        };

        db.products.push(product);

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: 'Admin',
            action: 'Uploaded product "' + name + '"',
            status: 'Complete'
        });

        saveDb(db);
        res.status(201).json({ success: true, product });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to upload product.' });
    }
});

// ---------- Admin delete product ----------
// ---------- Public products list ----------
app.get('/api/products', (req, res) => {
    const db = getDb();
    res.json(db.products || []);
});

// ---------- Admin: upload product ----------
app.post('/api/admin/products', verifyAdminToken, upload.single('image'), (req, res) => {
    try {
        const { name, price, category, description } = req.body;
        if (!name || !price) return res.status(400).json({ message: 'Name and price are required.' });

        const db = getDb();

        const nextId = db.products.length ? Math.max(...db.products.map(p => p.id)) + 1 : 1;
        const generatedId = "PRD" + Math.floor(100 + Math.random() * 900);
        const imagePath = req.file ? '/uploads/' + req.file.filename : null;

        const product = {
            id: nextId,
            productId: generatedId,
            name,
            price: parseFloat(price),
            category: category || 'Uncategorized',
            description: description || '',
            image: imagePath
        };

        db.products.push(product);

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: 'Admin',
            action: 'Uploaded product "' + name + '"',
            status: 'Complete'
        });

        saveDb(db);
        res.status(201).json({ success: true, product });
    } catch (err) {
        console.error('UPLOAD ERROR:', err);
        res.status(500).json({ message: 'Failed to upload product.', error: err.message });
    }
});
app.delete('/api/admin/products/:id', verifyAdminToken, (req, res) => {
    const db = getDb();

    const product = db.products.find(p => p.productId === req.params.id || String(p.id) === req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    if (product.image) {
        const filePath = path.join(__dirname, 'public', product.image);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.products = db.products.filter(p => p.productId !== product.productId);

    const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
    db.activities.unshift({
        id: nextActId,
        activityId: Math.floor(1000 + Math.random() * 9000).toString(),
        userName: 'Admin',
        action: 'Deleted product "' + product.name + '"',
        status: 'Complete'
    });

    saveDb(db);
    res.json({ success: true, message: 'Product deleted.' });
});
// ---------- Public products ----------
app.get('/api/products', (req, res) => {
    const db = getDb();
    res.json(db.products || []);
});

// ---------- Admin: upload product ----------
app.post('/api/admin-product', verifyAdminToken, upload.single('image'), (req, res) => {
    try {
        const { name, price, category, description } = req.body;
        if (!name || !price) return res.status(400).json({ message: 'Name and price are required.' });

        const db = getDb();

        const nextId = db.products.length ? Math.max(...db.products.map(p => p.id)) + 1 : 1;
        const generatedId = "PRD" + Math.floor(100 + Math.random() * 900);
        const imagePath = req.file ? '/uploads/' + req.file.filename : null;

        const product = {
            id: nextId,
            productId: generatedId,
            name,
            price: parseFloat(price),
            category: category || 'Uncategorized',
            description: description || '',
            image: imagePath
        };

        db.products.push(product);

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: 'Admin',
            action: 'Uploaded product "' + name + '"',
            status: 'Complete'
        });

        saveDb(db);
        res.status(201).json({ success: true, product });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Failed to upload product.' });
    }
});

// ---------- Admin: delete product ----------
app.delete('/api/admin/products/:id', verifyAdminToken, (req, res) => {
    const db = getDb();

    const product = db.products.find(p => p.productId === req.params.id || String(p.id) === req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found.' });

    if (product.image) {
        const filePath = path.join(__dirname, 'public', product.image);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    db.products = db.products.filter(p => p.productId !== product.productId);

    const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
    db.activities.unshift({
        id: nextActId,
        activityId: Math.floor(1000 + Math.random() * 9000).toString(),
        userName: 'Admin',
        action: 'Deleted product "' + product.name + '"',
        status: 'Complete'
    });

    saveDb(db);
    res.json({ success: true, message: 'Product deleted.' });
});
// ---------- Public: get payment info ----------
app.get('/api/payment-info', (req, res) => {
    res.json({ momoNumber: MOMO_NUMBER, momoName: MOMO_NAME });
});

// ---------- Place an order (customer) ----------
app.post('/api/orders', async (req, res) => {
    try {
        const { customerName, customerPhone, network, transactionId, items, total } = req.body;

        if (!customerName || !customerPhone || !transactionId || !items || !items.length) {
            return res.status(400).json({ message: 'Please fill in all required fields.' });
        }
        if (!total || total <= 0) {
            return res.status(400).json({ message: 'Invalid order total.' });
        }

        const db = getDb();
        const nextId = db.orders.length ? Math.max(...db.orders.map(o => o.id)) + 1 : 1;
        const orderNumber = 'ORD-' + String(Date.now()).slice(-6);

        const order = {
            id: nextId,
            orderNumber: orderNumber,
            customerName: customerName,
            customerPhone: customerPhone,
            network: network || 'Unknown',
            transactionId: transactionId,
            items: items,
            total: parseFloat(total),
            status: 'Pending',
            createdAt: new Date().toISOString()
        };

        db.orders.unshift(order);

        // Log activity
        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: customerName,
            action: 'Placed order ' + orderNumber + ' (' + Number(total) + ' RWF)',
            status: 'Pending'
        });

        saveDb(db);

        // Notify admin by email (fails silently if email not set up)
        const itemsList = items.map(function (i) {
            return '<li>' + i.name + ' × ' + i.qty + ' — ' + (i.price * i.qty)+ ' RWF</li>';
        }).join('');

        sendEmail({
            to: ADMIN_EMAIL,
            subject: '🛒 New order ' + orderNumber + ' from ' + customerName,
            html: `
                <div style="font-family:Arial;max-width:600px;margin:auto;padding:2rem;background:#111;color:#f0f0f0;border-radius:10px;">
                    <h2 style="color:#f4a261;">New order received</h2>
                    <p><strong>Order:</strong> ${orderNumber}</p>
                    <p><strong>Customer:</strong> ${customerName}</p>
                    <p><strong>Phone:</strong> ${customerPhone} (${network})</p>
                    <p><strong>Transaction ID:</strong> ${transactionId}</p>
                    <hr style="border-color:#333;">
                    <p><strong>Items:</strong></p>
                    <ul>${itemsList}</ul>
                    <p style="font-size:1.2rem;color:#f4a261;"><strong>Total:</strong> ${Number(total)} RWF</p>
                    <p style="color:#888;font-size:0.85rem;">Verify this transaction in your MoMo app before marking as paid.</p>
                </div>
            `
        });

        res.status(201).json({ success: true, orderNumber: orderNumber });
    } catch (err) {
        console.error('ORDER ERROR:', err);
        res.status(500).json({ message: 'Failed to place order.' });
    }
});

// ---------- Admin: view all orders ----------
app.get('/api/admin/orders', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.orders || []);
});

// ---------- Admin: update order status ----------
app.put('/api/admin/orders/:orderNumber', verifyAdminToken, (req, res) => {
    const db = getDb();
    const order = db.orders.find(o => o.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'Status is required.' });

    order.status = status;
    saveDb(db);
    res.json({ success: true, order: order });
});
// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => console.log(...));
    console.log("🚀 SUCCESS! Fuego's Style engine operational at http://localhost:" + PORT);
})
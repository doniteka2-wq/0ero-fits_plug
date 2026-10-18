require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Mailjet = require('node-mailjet');                onst app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-env';
const DB_FILE = path.join(__dirname, 'database_v24.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

const MOMO_NUMBER = process.env.MOMO_NUMBER || '0795828020';
const MOMO_NAME = process.env.MOMO_NAME || "Muhizi Michel";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';


if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- Database helpers ----------
function getDb() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initial = { users: [], activities: [], products: [], orders: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        parsed.users = parsed.users || [];
        parsed.activities = parsed.activities || [];
        parsed.products = parsed.products || [];
        parsed.orders = parsed.orders || [];
        return parsed;
    } catch (err) {
        console.error('❌ Database corrupted:', err.message);
        process.exit(1);
    }
}

function saveDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- Multer (image uploads) ----------
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

// ---------- Email helper (stub — swap for real Nodemailer later) ----------
async function sendEmail({ to, subject, html }) {
    console.log('📧 [Email stub] To:', to, '| Subject:', subject);
    return true;
}

// ---------- Admin credentials ----------
const ADMIN_CREDENTIALS = {
    username: 'admin',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '$2a$10$O928XGxRUMAZ0IZxJxHKlehe64t115XkH02oFlnW9wsknQ/xR9WCy'
};

// ---------- Auth middleware ----------
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

// ---------- Root ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- User: register ----------
app.post('/api/users/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const db = getDb();
        if (db.users.some(u => u.email === email)) {
            return res.status(400).json({ message: 'Email already registered.' });
        }

        const nextId = db.users.length ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
        const generatedId = 'USR' + Math.floor(100 + Math.random() * 900);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        db.users.push({
            id: nextId,
            userId: generatedId,
            name,
            email,
            passwordHash: hashedPassword,
            status: 'Active'
        });

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: name,
            action: 'Registered a new account',
            status: 'Complete'
        });

        saveDb(db);

      sendEmail({
    to: email,
    subject: "Welcome to Fuego's Style 🔥",
    html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#111;color:#f0f0f0;padding:2rem;border-radius:10px;">
            <h1 style="color:#f4a261;">🔥 Welcome, ${name}!</h1>
            <p>Your Fuego's Style account is ready. Start shopping our latest drops.</p>
            <p style="margin:2rem 0;">
                <a href="${process.env.BASE_URL || 'http://localhost:3000'}/"
                   style="background:#d62828;color:white;padding:0.75rem 1.5rem;text-decoration:none;border-radius:8px;font-weight:bold;display:inline-block;">
                   Shop Now
                </a>
            </p>
            <p style="color:#888;font-size:0.85rem;">You're receiving this because you created an account with us.</p>
        </div>
    `
});

        res.status(201).json({ success: true, message: 'Account configured successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server registration failure.' });
    }
});

// ---------- User: login ----------
app.post('/api/users/login', async (req, res) => {
    const { email, password } = req.body;
    const db = getDb();
    const user = db.users.find(u => u.email === email);

    if (!user || !user.passwordHash) {
        return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials.' });

    const token = jwt.sign({ id: user.userId, role: 'customer' }, JWT_SECRET, { expiresIn: '6h' });
    res.json({ success: true, token });
});

// ---------- User: reset password ----------
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

// ---------- Admin: login ----------
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    if (username !== ADMIN_CREDENTIALS.username) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, ADMIN_CREDENTIALS.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ success: true, token });
});

// ---------- Admin: metrics ----------
app.get('/api/admin/metrics', verifyAdminToken, (req, res) => {
    const db = getDb();
    const paidOrders = db.orders.filter(o => o.status === 'Paid');
    const revenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0);

    res.json({
        totalSales: revenue,
        activeUsers: db.users.length,
        pendingOrders: db.orders.filter(o => o.status === 'Pending').length,
        totalOrders: db.orders.length
    });
});

// ---------- Admin: activities ----------
app.get('/api/admin/activities', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.activities.slice(0, 10));
});

// ---------- Admin: users ----------
app.get('/api/admin/users', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.users.map(({ passwordHash, ...rest }) => rest));
});

app.delete('/api/admin/users/:id', verifyAdminToken, (req, res) => {
    const db = getDb();
    const before = db.users.length;
    db.users = db.users.filter(u => u.userId !== req.params.id);

    if (db.users.length < before) {
        saveDb(db);
        return res.json({ success: true, message: 'User deleted.' });
    }
    res.status(404).json({ message: 'User not found.' });
});

// ---------- Products: public list ----------
app.get('/api/products', (req, res) => {
    const db = getDb();
    res.json(db.products || []);
});

// ---------- Products: admin upload ----------
app.post('/api/admin/products', verifyAdminToken, upload.single('image'), (req, res) => {
    try {
        const { name, price, category, description } = req.body;
        if (!name || !price) return res.status(400).json({ message: 'Name and price are required.' });

        const db = getDb();
        const nextId = db.products.length ? Math.max(...db.products.map(p => p.id)) + 1 : 1;
        const generatedId = 'PRD' + Math.floor(100 + Math.random() * 900);
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
        res.status(500).json({ message: 'Failed to upload product.' });
    }
});

// ---------- Products: admin delete ----------
app.delete('/api/admin/products/:id', verifyAdminToken, (req, res) => {
    const db = getDb();
    const product = db.products.find(p => p.productId === req.params.id);
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

// ---------- Payment info ----------
app.get('/api/payment-info', (req, res) => {
    res.json({ momoNumber: MOMO_NUMBER, momoName: MOMO_NAME });
});

// ---------- Orders: place order ----------
app.post('/api/orders', verifyCustomerToken, async (req, res) => {
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
            orderNumber,
            customerName,
            customerPhone,
            network: network || 'Unknown',
            transactionId,
            items,
            total: parseFloat(total),
            status: 'Pending',
            createdAt: new Date().toISOString()
        };

        db.orders.unshift(order);

        const nextActId = db.activities.length ? Math.max(...db.activities.map(a => a.id)) + 1 : 1;
        db.activities.unshift({
            id: nextActId,
            activityId: Math.floor(1000 + Math.random() * 9000).toString(),
            userName: customerName,
            action: 'Placed order ' + orderNumber + ' (' + Number(total).toFixed(2) + ' RWF)',
            status: 'Pending'
        });

        saveDb(db);

        const itemsList = items.map(function (i) {
            return '<li>' + i.name + ' x ' + i.qty + ' - ' + (i.price * i.qty).toFixed(2) + ' RWF</li>';
        }).join('');

        sendEmail({
            to: ADMIN_EMAIL,
            subject: 'New order ' + orderNumber + ' from ' + customerName,
            html: '<h2>New order ' + orderNumber + '</h2>' +
                  '<p><strong>Customer:</strong> ' + customerName + '</p>' +
                  '<p><strong>Phone:</strong> ' + customerPhone + ' (' + network + ')</p>' +
                  '<p><strong>Transaction ID:</strong> ' + transactionId + '</p>' +
                  '<ul>' + itemsList + '</ul>' +
                  '<p><strong>Total:</strong> ' + Number(total).toFixed(2) + ' RWF</p>'
        });

        res.status(201).json({ success: true, orderNumber });
    } catch (err) {
        console.error('ORDER ERROR:', err);
        res.status(500).json({ message: 'Failed to place order.' });
    }
});

// ---------- Orders: admin list ----------
app.get('/api/admin/orders', verifyAdminToken, (req, res) => {
    const db = getDb();
    res.json(db.orders || []);
});

// ---------- Orders: admin update status ----------
app.put('/api/admin/orders/:orderNumber', verifyAdminToken, (req, res) => {
    const db = getDb();
    const order = db.orders.find(o => o.orderNumber === req.params.orderNumber);
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    const { status } = req.body;
    if (!status) return res.status(400).json({ message: 'Status is required.' });

    order.status = status;
    saveDb(db);
    res.json({ success: true, order });
});

// ---------- Start the server ----------
app.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 SUCCESS! Fuego's Style engine operational at http://localhost:" + PORT);
});
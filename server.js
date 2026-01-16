const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed'));
    }
});

// Initialize SQLite database
const dbPath = path.join(__dirname, 'hackerblog.db');
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        content TEXT NOT NULL,
        image_path TEXT,
        post_date TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

console.log('✓ SQLite database initialized');

// ============== API ROUTES ==============

// GET all posts
app.get('/api/posts', (req, res) => {
    try {
        const posts = db.prepare('SELECT * FROM posts ORDER BY post_date DESC, created_at DESC').all();
        res.json(posts);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

// GET single post
app.get('/api/posts/:id', (req, res) => {
    try {
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }
        res.json(post);
    } catch (error) {
        console.error('Error fetching post:', error);
        res.status(500).json({ error: 'Failed to fetch post' });
    }
});

// CREATE post
app.post('/api/posts', upload.single('image'), (req, res) => {
    try {
        const { title, excerpt, content, post_date } = req.body;
        const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

        const stmt = db.prepare(
            'INSERT INTO posts (title, excerpt, content, image_path, post_date) VALUES (?, ?, ?, ?, ?)'
        );
        const result = stmt.run(title, excerpt, content, imagePath, post_date);

        const newPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newPost);
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({ error: 'Failed to create post' });
    }
});

// UPDATE post
app.put('/api/posts/:id', upload.single('image'), (req, res) => {
    try {
        const { title, excerpt, content, post_date, keep_image } = req.body;
        const postId = req.params.id;

        // Get current post to check for existing image
        const currentPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        if (!currentPost) {
            return res.status(404).json({ error: 'Post not found' });
        }

        let imagePath = currentPost.image_path;

        // Handle image update
        if (req.file) {
            // Delete old image if exists
            if (currentPost.image_path) {
                const oldImagePath = path.join(__dirname, currentPost.image_path);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            imagePath = `/uploads/${req.file.filename}`;
        } else if (keep_image === 'false') {
            // Remove image
            if (currentPost.image_path) {
                const oldImagePath = path.join(__dirname, currentPost.image_path);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            imagePath = null;
        }

        const stmt = db.prepare(
            'UPDATE posts SET title = ?, excerpt = ?, content = ?, image_path = ?, post_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        );
        stmt.run(title, excerpt, content, imagePath, post_date, postId);

        const updatedPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
        res.json(updatedPost);
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ error: 'Failed to update post' });
    }
});

// DELETE post
app.delete('/api/posts/:id', (req, res) => {
    try {
        const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
        
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Delete associated image file
        if (post.image_path) {
            const imagePath = path.join(__dirname, post.image_path);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ error: 'Failed to delete post' });
    }
});

// ============== NEWSLETTER ROUTES ==============

// Subscribe to newsletter
app.post('/api/subscribe', (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const stmt = db.prepare('INSERT INTO subscribers (email) VALUES (?)');
        stmt.run(email);
        res.status(201).json({ message: 'Subscribed successfully' });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'Already subscribed' });
        }
        console.error('Error subscribing:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

// GET all subscribers (admin)
app.get('/api/subscribers', (req, res) => {
    try {
        const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY subscribed_at DESC').all();
        res.json(subscribers);
    } catch (error) {
        console.error('Error fetching subscribers:', error);
        res.status(500).json({ error: 'Failed to fetch subscribers' });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 HackerBlog server running at http://localhost:${PORT}`);
    console.log(`   API endpoints available at http://localhost:${PORT}/api/posts\n`);
});

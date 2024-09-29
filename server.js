const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");
const cors = require("cors"); 
const credentials = require("./serviceAccountKey.json");

admin.initializeApp({
    credential: admin.credential.cert(credentials),
});

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET;


app.post('/signup', async (req, res) => {
    const user = {
        email: req.body.email,
        password: req.body.password,
    };

    try {
        const hashedPassword = await bcrypt.hash(user.password, 8);
    
        const userResponse = await admin.auth().createUser({
            email: user.email,
            password: hashedPassword,
            emailVerified: false,
            disabled: false
        });
        res.json(userResponse);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const userRecord = await admin.auth().getUserByEmail(email);

        const token = jwt.sign({ uid: userRecord.uid }, JWT_SECRET, { expiresIn: '1h' });
        
        res.json({ token });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Сервер запущен на ${PORT}`);
});

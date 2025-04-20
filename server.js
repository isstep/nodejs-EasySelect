const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const nodemailer = require("nodemailer");
const fs = require("fs");
const axios = require('axios');

dotenv.config();

const requiredEnvVars = ['JWT_SECRET', 'FIREBASE_PROJECT_ID', 'EMAIL_USER', 'EMAIL_PASS'];
for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
        console.error(`Ошибка: ${varName} не установлен в переменных окружения.`);
        process.exit(1);
    }
}
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
    console.error("Ошибка: Файл serviceAccountKey.json не найден.");
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET;

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',  
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const REDIRECT_URL = 'https://easy-select.vercel.app/succses';  


const sendVerificationEmail = async (email, userId) => {
    const verificationLink = `https://nodejs-server-sfel.onrender.com/verify-email?uid=${userId}`;

    const mailOptions = {
        from: '<easyselectbot@gmail.com>',
        to: email,
        subject: 'Подтверждение регистрации',
        html: `<!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <title>Подтвердите свой аккаунт</title>
        <style>
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #f4f4f4;
            color: #333;
            margin: 0;
            padding: 0;
            line-height: 1.6;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background-color: #fff;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
            border: 1px solid #e0e0e0;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .header img {
            max-width: 150px;
            height: auto;
        }
        .content {
            margin-bottom: 30px;
            text-align: center; /* Центрируем текст */
        }
        .button-container {
            text-align: center; /* Центрируем кнопку */
        }
        .button {
            display: inline-block;
            padding: 12px 24px;
            font-size: 16px;
            font-weight: bold;
            text-decoration: none;
            background-color: #28a745; /* Зеленый цвет для продуктового магазина */
            color: #fff;
            border-radius: 6px;
            transition: background-color 0.3s ease;
            border: none;
            cursor: pointer;
        }
        .button:hover {
            background-color: #218838;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #777;
            margin-top: 20px;
        }
        .footer a {
            color: #777;
            text-decoration: none;
        }
        </style>
        </head>
        <body>
        <div class="container">
            <div class="header">
                <img src="https://i.imgur.com/your-logo-here.png" alt="Easy Select Logo">
                <h1>Easy Select</h1>
            </div>
            <div class="content">
                <p>Здравствуйте!</p>
                <p>Спасибо за регистрацию в Easy Select, вашем надежном помощнике в выборе лучших товаров!</p>
                <p>Пожалуйста, нажмите на кнопку ниже, чтобы подтвердить свой аккаунт и начать пользоваться всеми преимуществами нашего сервиса:</p>
            </div>
            <div class="button-container">
                <a href="${verificationLink}" class="button">
                    Подтвердить аккаунт
                </a>
            </div>
            <div class="footer">
                <p>С уважением, команда Easy Select</p>
                <p>Если у вас возникли вопросы, посетите наш <a href="https://easy-select.vercel.app/support">центр поддержки</a>.</p>
            </div>
        </div>
        </body>
        </html>`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Письмо для подтверждения отправлено:', email);
    } catch (error) {
        console.error('Ошибка при отправке письма:', error.message);
    }
};

app.post('/signup', async (req, res) => {
    const { firstName, lastName, address, phoneNumber, email, password, confirmPassword } = req.body;

    if (!email || !password || !firstName || !lastName || !address || !phoneNumber || !confirmPassword) {
        return res.status(400).json({ error: "Все поля обязательны." });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: "Пароли не совпадают." });
    }

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();

        if (!snapshot.empty) {
            return res.status(400).json({ error: "Пользователь с таким email уже существует." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            firstName,
            lastName,
            address,
            phoneNumber,
            email,
            password: hashedPassword,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isVerified: false,
        };

        const userDoc = await usersRef.add(newUser);
        await sendVerificationEmail(email, userDoc.id);

        res.status(201).json({ message: "Пользователь зарегистрирован успешно. Проверьте почту для подтверждения." });
    } catch (error) {
        console.error("Ошибка при регистрации:", error.message);
        res.status(500).json({ error: "Внутренняя ошибка сервера." });
    }
});

app.get('/verify-email', async (req, res) => {
    const { uid } = req.query;

    if (!uid) {
        return res.status(400).json({ error: "Необходим идентификатор пользователя." });
    }

    try {
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: "Пользователь не найден." });
        }

        if (userDoc.data().isVerified) {
             return res.redirect(`${REDIRECT_URL}?message=Email already verified`);
        }

        await db.collection('users').doc(uid).update({ isVerified: true });

        return res.redirect(`${REDIRECT_URL}?message=Email verified successfully`);

    } catch (error) {
        console.error('Ошибка при подтверждении email:', error.message);
        return res.redirect(`${REDIRECT_URL}?error=Server error during verification`);
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email и пароль обязательны." });
    }

    try {
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (snapshot.empty) {
            return res.status(400).json({ error: "Неверный email или пароль." });
        }

        const userDoc = snapshot.docs[0];
        const userData = userDoc.data();

        if (!userData.isVerified) {
            return res.status(403).json({ error: "Пожалуйста, подтвердите свой email, прежде чем войти." });
        }

        const isMatch = await bcrypt.compare(password, userData.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Неверный email или пароль." });
        }

        const token = jwt.sign({ uid: userDoc.id, email: userData.email }, JWT_SECRET, { expiresIn: '1h' });

        res.json({ token });
    } catch (error) {
        console.error("Ошибка при логине:", error.message);
        res.status(500).json({ error: "Внутренняя ошибка сервера." });
    }
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Нет доступа. Токен не предоставлен." });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ error: "Неверный токен." });
        }
        req.user = decoded;
        next();
    });
};

app.get('/protected', authenticateToken, (req, res) => {
    res.json({ message: "Доступ разрешён.", user: req.user });
});


app.get('/ping', (req, res) => {
    res.status(200).send('Server is active');
});


const keepAlive = () => {
    setInterval(async () => {
        try {
            await axios.get('https://nodejs-server-sfel.onrender.com/ping'); 
            console.log('Ping успешно отправлен');
        } catch (error) {
            console.error('Ошибка при отправке ping:', error.message);
        }
    }, 49000);
};

keepAlive(); 

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
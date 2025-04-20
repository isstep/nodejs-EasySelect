const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const admin = require("firebase-admin");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const nodemailer = require("nodemailer");
const fs = require("fs");
const axios = require("axios");

dotenv.config();

const requiredEnvVars = [
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "EMAIL_USER",
  "EMAIL_PASS",
];
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
  host: "smtp.gmail.com",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const REDIRECT_URL = "https://easy-select.vercel.app/succses";

const sendVerificationEmail = async (email, userId) => {
  const verificationLink = `https://nodejs-server-sfel.onrender.com/verify-email?uid=${userId}`;

  const mailOptions = {
    from: "<easyselectbot@gmail.com>",
    to: email,
    subject: "Подтверждение регистрации",
    html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Подтвердите свой аккаунт</title>
<style>
body {
    font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    background-color: #f0f9f4;
    color: #000000; 
    margin: 0;
    padding: 0;
    line-height: 1.7;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    min-height: 100vh;
}

.container {
    max-width: 560px;
    margin: 32px;
    background-color: #ffffff;
    padding: 48px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
    border: 1px solid rgba(0, 0, 0, 0.08);
}

.header {
    text-align: left;
    margin-bottom: 40px;
}


.header h1 {
    font-size: 2rem;
    font-weight: 700;
    color: #10b981;
    margin-bottom: 8px;
}

.content {
    margin-bottom: 40px;
}

.content p {
    font-size: 1rem;
    color: #0622189d;
    margin-bottom: 20px;
}

.button-container {
    text-align: left;
}

.button {
    display: inline-block;
    padding: 14px 32px;
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    background-color: #10b981;
    color: white;
    border-radius: 8px;
    transition: background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
    border: none;
    cursor: pointer;
    text-decoration: none;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.button:hover {
    background-color: #059669;
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
}

.button:active {
    transform: translateY(1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.footer {
    text-align: left;
    font-size: 0.875rem;
    color: #05461484;
    margin-top: 32px;
}

.footer a {
    color: #4ade80;
    text-decoration: underline;
}

.footer a:hover {
    color: #22c55e;
}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>EasySelect</h1>
    </div>
    <div class="content">
        <p>Здравствуйте !</p>
        <p>Спасибо за регистрацию в EasySelect!</p>
        <p>Пожалуйста, нажмите на кнопку ниже, чтобы подтвердить свой аккаунт:</p>
    </div>
    <div class="button-container">
        <a href="${verificationLink}" class="button">
            Подтвердить аккаунт
        </a>
    </div>
    <div class="footer">
        <p>С уважением, EasySelect</p>
    </div>
</div>
</body>
</html>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Письмо для подтверждения отправлено:", email);
  } catch (error) {
    console.error("Ошибка при отправке письма:", error.message);
  }
};

app.post("/signup", async (req, res) => {
  const {
    firstName,
    lastName,
    address,
    phoneNumber,
    email,
    password,
    confirmPassword,
  } = req.body;

  if (
    !email ||
    !password ||
    !firstName ||
    !lastName ||
    !address ||
    !phoneNumber ||
    !confirmPassword
  ) {
    return res.status(400).json({ error: "Все поля обязательны." });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Пароли не совпадают." });
  }

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("email", "==", email).get();

    if (!snapshot.empty) {
      return res
        .status(400)
        .json({ error: "Пользователь с таким email уже существует." });
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

    res
      .status(201)
      .json({
        message:
          "Пользователь зарегистрирован успешно. Проверьте почту для подтверждения.",
      });
  } catch (error) {
    console.error("Ошибка при регистрации:", error.message);
    res.status(500).json({ error: "Внутренняя ошибка сервера." });
  }
});

app.get("/verify-email", async (req, res) => {
  const { uid } = req.query;

  if (!uid) {
    return res
      .status(400)
      .json({ error: "Необходим идентификатор пользователя." });
  }

  try {
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "Пользователь не найден." });
    }

    if (userDoc.data().isVerified) {
      return res.redirect(`${REDIRECT_URL}?message=Email already verified`);
    }

    await db.collection("users").doc(uid).update({ isVerified: true });

    return res.redirect(`${REDIRECT_URL}?message=Email verified successfully`);
  } catch (error) {
    console.error("Ошибка при подтверждении email:", error.message);
    return res.redirect(
      `${REDIRECT_URL}?error=Server error during verification`
    );
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email и пароль обязательны." });
  }

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("email", "==", email).limit(1).get();

    if (snapshot.empty) {
      return res.status(400).json({ error: "Неверный email или пароль." });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    if (!userData.isVerified) {
      return res
        .status(403)
        .json({
          error: "Пожалуйста, подтвердите свой email, прежде чем войти.",
        });
    }

    const isMatch = await bcrypt.compare(password, userData.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Неверный email или пароль." });
    }

    const token = jwt.sign(
      { uid: userDoc.id, email: userData.email },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token });
  } catch (error) {
    console.error("Ошибка при логине:", error.message);
    res.status(500).json({ error: "Внутренняя ошибка сервера." });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Нет доступа. Токен не предоставлен." });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Неверный токен." });
    }
    req.user = decoded;
    next();
  });
};

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "Доступ разрешён.", user: req.user });
});

app.get("/ping", (req, res) => {
  res.status(200).send("Server is active");
});

const keepAlive = () => {
  setInterval(async () => {
    try {
      await axios.get("https://nodejs-server-sfel.onrender.com/ping");
      console.log("Ping успешно отправлен");
    } catch (error) {
      console.error("Ошибка при отправке ping:", error.message);
    }
  }, 49000);
};

keepAlive();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

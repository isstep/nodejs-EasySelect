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
const crypto = require("crypto");
const winston = require("winston");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  SectionType,
  Header,
  Footer,
  PageNumber,
} = require("docx");

dotenv.config();

const requiredEnvVars = [
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "EMAIL_USER",
  "EMAIL_PASS",
  "OSRM_URL",
  "FUEL_PRICE",
  "FUEL_CONSUMPTION_RATE",
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
const TRANSPORTER_USER = process.env.EMAIL_USER;
const TRANSPORTER_PASS = process.env.EMAIL_PASS;

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  auth: {
    user: TRANSPORTER_USER,
    pass: TRANSPORTER_PASS,
  },
});

const CLIENT_REDIRECT_URL =
  process.env.CLIENT_REDIRECT_URL || "https://easy-select.vercel.app/succses";
const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL || "https://nodejs-server-sfel.onrender.com";

const OSRM_URL = process.env.OSRM_URL;
const FUEL_PRICE = parseFloat(process.env.FUEL_PRICE);
const FUEL_CONSUMPTION_RATE = parseFloat(process.env.FUEL_CONSUMPTION_RATE);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

const sendVerificationEmail = async (email, userId) => {
  const verificationLink = `${SERVER_BASE_URL}/verify-email?uid=${userId}`;
  const mailOptions = {
    from: "EasySelect",
    to: email,
    subject: "Подтверждение регистрации",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Подтвердите свой аккаунт</title><style>body{font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,'Open Sans','Helvetica Neue',sans-serif;background-color:#f0f9f4;color:#000;margin:0;padding:0;line-height:1.7;display:flex;justify-content:flex-start;align-items:flex-start;min-height:100vh}.container{max-width:560px;margin:32px;background-color:#fff;padding:48px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08);border:1px solid rgba(0,0,0,.08)}.header{text-align:left;margin-bottom:40px}.header h1{font-size:2rem;font-weight:700;color:#10b981;margin-bottom:8px}.content{margin-bottom:40px}.content p{font-size:1rem;color:#0622189d;margin-bottom:20px}.button-container{text-align:left}.button{display:inline-block;padding:14px 32px;font-size:1rem;font-weight:600;text-decoration:none;background-color:#10b981;color:#fff!important;border-radius:8px;transition:background-color .2s ease-in-out,box-shadow .2s ease-in-out;border:none;cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,.1)}.button:hover{background-color:#059669;box-shadow:0 6px 8px rgba(0,0,0,.15)}.button:active{transform:translateY(1px);box-shadow:0 2px 4px rgba(0,0,0,.1)}.footer{text-align:left;font-size:.875rem;color:rgba(0,0,0,.37);margin-top:32px}.footer a{color:#4ade80;text-decoration:underline}.footer a:hover{color:#22c55e}</style></head><body><div class="container"><div class="header"><h1>EasySelect</h1></div><div class="content"><p>Здравствуйте !</p><p>Спасибо за регистрацию в EasySelect!</p><p>Пожалуйста, нажмите на кнопку ниже, чтобы подтвердить свой аккаунт:</p></div><div class="button-container"><a href="${verificationLink}" class="button" style="text-decoration:none!important">Подтвердить аккаунт</a></div><div class="footer"><p>С уважением, EasySelect</p></div></div></body></html>`,
  };
  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Письмо для подтверждения отправлено: ${email}`);
  } catch (error) {
    logger.error(`Ошибка при отправке письма для ${email}: ${error.message}`, {
      error,
    });
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
      isAdmin: false,
    };
    const userDoc = await usersRef.add(newUser);
    await sendVerificationEmail(email, userDoc.id);
    res.status(201).json({
      message:
        "Пользователь зарегистрирован успешно. Проверьте почту для подтверждения.",
    });
  } catch (error) {
    logger.error("Ошибка при регистрации:", {
      error: error.message,
      stack: error.stack,
    });
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
    const userDocRef = db.collection("users").doc(uid);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "Пользователь не найден." });
    }
    if (userDoc.data().isVerified) {
      return res.redirect(
        `${CLIENT_REDIRECT_URL}?message=Email+already+verified`
      );
    }
    await userDocRef.update({ isVerified: true });
    return res.redirect(
      `${CLIENT_REDIRECT_URL}?message=Email+verified+successfully`
    );
  } catch (error) {
    logger.error("Ошибка при подтверждении email:", {
      error: error.message,
      stack: error.stack,
      uid,
    });
    return res.redirect(
      `${CLIENT_REDIRECT_URL}?error=Server+error+during+verification`
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
      return res.status(403).json({
        error: "Пожалуйста, подтвердите свой email, прежде чем войти.",
      });
    }
    const isMatch = await bcrypt.compare(password, userData.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Неверный email или пароль." });
    }

    const isAdminUser = userData.isAdmin === true;
    const tokenPayload = {
      uid: userDoc.id,
      email: userData.email,
      isAdmin: isAdminUser,
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "5h" });
    const { password: _, ...safeUserData } = userData;
    const redirectTo = isAdminUser ? "/adm" : "/";
    res.json({ token, user: { uid: userDoc.id, ...safeUserData }, redirectTo });
  } catch (error) {
    logger.error("Ошибка при логине:", {
      error: error.message,
      stack: error.stack,
      email,
    });
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

const isAdmin = (req, res, next) => {
  if (req.user && req.user.isAdmin === true) {
    next();
  } else {
    logger.warn(
      `Попытка доступа к админ-ресурсу без прав: user ${req.user?.uid || "unknown"}`,
      { path: req.path }
    );
    res
      .status(403)
      .json({ error: "Доступ запрещен. Требуются права администратора." });
  }
};

app.get("/protected", authenticateToken, (req, res) => {
  res.json({ message: "Доступ разрешён.", user: req.user });
});

app.get("/ping", (req, res) => {
  res.status(200).send("Server is active");
});

app.post("/orders", authenticateToken, async (req, res) => {
  const { foods, totalPrice } = req.body;
  const userId = req.user.uid;
  if (!foods || !Array.isArray(foods) || foods.length === 0) {
    return res
      .status(400)
      .json({ error: "Список товаров (foods) не может быть пустым." });
  }
  if (typeof totalPrice !== "number" || totalPrice <= 0) {
    return res
      .status(400)
      .json({ error: "Некорректная общая сумма заказа (totalPrice)." });
  }
  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }
  try {
    const userDocRef = db.collection("users").doc(userId);
    const userDoc = await userDocRef.get();
    if (!userDoc.exists) {
      logger.error(
        `Пользователь с ID ${userId} не найден в Firestore при создании заказа.`
      );
      return res.status(404).json({ error: "Данные пользователя не найдены." });
    }
    const userData = userDoc.data();
    const userAddress = userData.address;
    if (
      !userAddress ||
      typeof userAddress !== "string" ||
      userAddress.trim() === ""
    ) {
      logger.warn(
        `У пользователя ${userId} не указан адрес в профиле при создании заказа.`
      );
      return res.status(400).json({
        error:
          "Адрес доставки не указан в вашем профиле. Пожалуйста, обновите данные.",
      });
    }
    const randomDigits = Math.floor(Math.random() * 900 + 100).toString();
    const randomHexChar = crypto.randomBytes(1).toString("hex")[0];
    const timestampEnd = (Date.now() % 10000000).toString().padStart(7, "0");
    const generatedOrderId = `${randomDigits}${randomHexChar}${timestampEnd}`;
    const orderData = {
      orderId: generatedOrderId,
      userId,
      userEmail: userData.email,
      foods,
      totalPrice,
      address: userAddress,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending", // Initial status
    };
    const newOrderRef = db.collection("orders").doc();
    await newOrderRef.set(orderData);

    const logOrderCreation = {
      type: "order_creation",
      orderId: generatedOrderId,
      userId: userId,
      userEmail: userData.email,
      totalPrice: orderData.totalPrice,
      address: orderData.address,
      status: "created",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db.collection("processed_activity_log").add(logOrderCreation);

    logger.info(
      `Заказ с ID #${generatedOrderId} для пользователя ${userId} успешно создан. Адрес: ${userAddress}`
    );
    res
      .status(201)
      .json({ message: "Заказ успешно создан.", id: generatedOrderId });
  } catch (error) {
    logger.error("Ошибка при создании заказа:", {
      error: error.message,
      stack: error.stack,
      userId,
    });
    const logOrderFailure = {
      type: "order_creation_failed",
      userId: userId,
      error: error.message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection("processed_activity_log").add(logOrderFailure);
    } catch (logError) {
      logger.error("Ошибка при логировании неудачи создания заказа:", logError);
    }
    res
      .status(500)
      .json({ error: "Внутренняя ошибка сервера при создании заказа." });
  }
});

app.get("/orders", authenticateToken, async (req, res) => {
  const userId = req.user.uid;
  if (!userId) {
    return res.status(401).json({ error: "Пользователь не авторизован." });
  }
  try {
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef
      .where("userId", "==", userId)
      .orderBy("createdAt", "desc")
      .get();
    if (snapshot.empty) {
      return res.status(200).json([]);
    }
    const userOrders = snapshot.docs.map((doc) => {
      const orderData = doc.data();
      return {
        id: orderData.orderId,
        firestoreDocId: doc.id,
        foods: orderData.foods,
        totalPrice: orderData.totalPrice,
        address: orderData.address,
        status: orderData.status,
        createdAt: orderData.createdAt.toDate().toISOString(),
      };
    });
    logger.info(
      `Найдено ${userOrders.length} заказов для пользователя ${userId}.`
    );
    res.status(200).json(userOrders);
  } catch (error) {
    logger.error("Ошибка при получении заказов:", {
      error: error.message,
      stack: error.stack,
      userId,
    });
    if (
      error.message &&
      error.message.includes("The query requires an index.")
    ) {
      logger.error(
        "ОШИБКА FIRESTORE: Требуется композитный индекс для /orders. Ссылка для создания должна быть в предыдущем логе ошибки."
      );
      return res.status(500).json({
        error:
          "Ошибка базы данных: отсутствует необходимый индекс. Проверьте логи сервера.",
      });
    }
    res
      .status(500)
      .json({ error: "Внутренняя ошибка сервера при получении заказов." });
  }
});

const calculateDistanceByRoad = async (loc1, loc2) => {
  if (
    !loc1 ||
    typeof loc1.lat !== "number" ||
    typeof loc1.lon !== "number" ||
    !loc2 ||
    typeof loc2.lat !== "number" ||
    typeof loc2.lon !== "number"
  ) {
    logger.error("Ошибка входных данных для calculateDistanceByRoad", {
      loc1,
      loc2,
    });
    return { distance: null, geometry: null, duration: null };
  }
  const url = `${OSRM_URL}/route/v1/driving/${loc1.lon},${loc1.lat};${loc2.lon},${loc2.lat}?overview=full&geometries=geojson&alternatives=false`;
  logger.info(`Запрос к OSRM: ${url}`);
  try {
    const { data } = await axios.get(url, { timeout: 15000 });
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      logger.warn(
        `OSRM не вернул маршрут для (${loc1.lon},${loc1.lat}) -> (${loc2.lon},${loc2.lat})`,
        { responseCode: data.code }
      );
      return { distance: null, geometry: null, duration: null };
    }
    const route = data.routes[0];
    return {
      distance: route.distance / 1000,
      geometry: route.geometry.coordinates,
      duration: route.duration,
    };
  } catch (error) {
    logger.error(`Ошибка при запросе к OSRM (${url})`, {
      error: error.message,
      errorData: error.response?.data,
    });
    return { distance: null, geometry: null, duration: null };
  }
};

const calculateFuelCost = (distance) => {
  if (typeof distance !== "number" || distance < 0) {
    return 0;
  }
  return (distance / 100) * FUEL_CONSUMPTION_RATE * FUEL_PRICE;
};

const solveTSPBranchAndBound = (n, distanceMatrix) => {
  const visited = new Array(n).fill(false);
  let minDistance = Infinity;
  let bestPathIndices = [];
  function branch(currentPathIndices, currentDistance) {
    if (currentDistance >= minDistance) {
      return;
    }
    if (currentPathIndices.length === n) {
      if (currentDistance < minDistance) {
        minDistance = currentDistance;
        bestPathIndices = [...currentPathIndices];
      }
      return;
    }
    const lastVisitedIndex = currentPathIndices[currentPathIndices.length - 1];
    for (let i = 0; i < n; i++) {
      if (!visited[i]) {
        const distanceToAdd = distanceMatrix[lastVisitedIndex][i];
        if (distanceToAdd === null || distanceToAdd === Infinity) {
          continue;
        }
        if (
          currentDistance + distanceToAdd >= minDistance &&
          currentPathIndices.length < n - 1
        ) {
          continue;
        }
        visited[i] = true;
        currentPathIndices.push(i);
        branch(currentPathIndices, currentDistance + distanceToAdd);
        visited[i] = false;
        currentPathIndices.pop();
      }
    }
  }
  visited[0] = true;
  branch([0], 0);
  return { minDistance, bestPathIndices };
};

app.post(
  "/api/logistics/process-route",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { points } = req.body;
    const requestId = `logistics-${Date.now()}`;
    logger.info(`[${requestId}] /api/logistics/process-route`, {
      pointsCount: points?.length,
    });

    if (!Array.isArray(points) || points.length < 2) {
      return res
        .status(400)
        .json({ error: "Требуется массив 'points' с минимум двумя точками." });
    }
    for (let i = 0; i < points.length; i++) {
      if (
        !points[i] ||
        typeof points[i].lat !== "number" ||
        typeof points[i].lon !== "number"
      ) {
        return res
          .status(400)
          .json({ error: `Точка ${i + 1} имеет неверный формат.` });
      }
      points[i].name = points[i].address || `Точка ${i + 1}`;
    }

    const n = points.length;
    const distanceMatrix = Array(n)
      .fill(null)
      .map(() => Array(n).fill(Infinity));
    const geometryMatrix = Array(n)
      .fill(null)
      .map(() => Array(n).fill(null));
    let osrmErrorOccurred = false;

    const distancePromises = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distanceMatrix[i][j] = 0;
          geometryMatrix[i][j] = [];
        } else {
          distancePromises.push(
            (async () => {
              try {
                const result = await calculateDistanceByRoad(
                  points[i],
                  points[j]
                );
                if (result.distance !== null) {
                  distanceMatrix[i][j] = result.distance;
                  geometryMatrix[i][j] = result.geometry;
                } else {
                  distanceMatrix[i][j] = Infinity;
                  osrmErrorOccurred = true;
                }
              } catch (error) {
                distanceMatrix[i][j] = Infinity;
                osrmErrorOccurred = true;
              }
            })()
          );
        }
      }
    }
    await Promise.all(distancePromises);

    if (osrmErrorOccurred) {
      logger.error(
        `[${requestId}] Ошибка OSRM при расчете матрицы расстояний.`
      );
      return res.status(503).json({
        error:
          "Ошибка сервиса маршрутизации. Не удалось рассчитать все сегменты.",
      });
    }

    const { minDistance: tspMinDistance, bestPathIndices } =
      solveTSPBranchAndBound(n, distanceMatrix);

    if (!bestPathIndices || bestPathIndices.length !== n) {
      logger.error(`[${requestId}] TSP не нашел валидный путь.`, {
        bestPathIndices,
      });
      return res
        .status(500)
        .json({ error: "Не удалось определить оптимальный маршрут." });
    }

    const finalRouteSegments = [];
    const finalCombinedGeometry = [];
    let totalActualRouteDistance = 0;

    for (let k = 0; k < bestPathIndices.length - 1; k++) {
      const fromIdx = bestPathIndices[k];
      const toIdx = bestPathIndices[k + 1];
      const segmentDist = distanceMatrix[fromIdx][toIdx];
      const segmentGeom = geometryMatrix[fromIdx][toIdx];

      if (segmentDist === Infinity || segmentDist === null || !segmentGeom) {
        logger.error(
          `[${requestId}] Отсутствуют данные для сегмента ${fromIdx}->${toIdx}.`
        );
        return res
          .status(500)
          .json({ error: "Внутренняя ошибка при сборке маршрута." });
      }
      totalActualRouteDistance += segmentDist;
      finalRouteSegments.push({
        from: {
          address: points[fromIdx].name,
          lat: points[fromIdx].lat,
          lon: points[fromIdx].lon,
        },
        to: {
          address: points[toIdx].name,
          lat: points[toIdx].lat,
          lon: points[toIdx].lon,
        },
        distance: parseFloat(segmentDist.toFixed(2)),
      });
      finalCombinedGeometry.push(
        ...(k === 0 ? segmentGeom : segmentGeom.slice(1))
      );
    }

    const finalFuelCost = calculateFuelCost(totalActualRouteDistance);

    const logRouteProcessing = {
      type: "route_processing",
      requestId: requestId,
      adminUserId: req.user.uid,
      pointsCount: points.length,
      optimalPointOrderNames: bestPathIndices.map(
        (index) => points[index].name
      ),
      calculatedDistance: parseFloat(totalActualRouteDistance.toFixed(2)),
      calculatedFuelCost: parseFloat(finalFuelCost.toFixed(2)),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: "success",
    };
    await db.collection("processed_activity_log").add(logRouteProcessing);

    logger.info(
      `[${requestId}] Маршрут рассчитан: ${totalActualRouteDistance.toFixed(2)} км, топливо: ${finalFuelCost.toFixed(2)}`
    );

    res.json({
      routePlan: finalRouteSegments,
      totalDistance: parseFloat(totalActualRouteDistance.toFixed(2)),
      fuelCost: parseFloat(finalFuelCost.toFixed(2)),
      geometry: finalCombinedGeometry,
      optimalPointOrder: bestPathIndices.map((index) => points[index].name),
    });
  }
);

const geocodeAddressOnServer = async (address) => {
  try {
    const response = await axios.get(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&addressdetails=1&limit=1&countrycodes=by,ru`
    );
    if (!response.data || response.data.length === 0) {
      logger.warn(`Nominatim (server): No results for address: ${address}`);
      return null;
    }
    const item = response.data[0];
    return {
      geocodedAddress: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
    };
  } catch (error) {
    logger.error(
      `Nominatim (server) geocoding error for address "${address}": ${error.message}`
    );
    return null;
  }
};

app.get(
  "/api/logistics/bases",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const basesSnapshot = await db
        .collection("logistics_bases")
        .orderBy("name")
        .get();
      const basesList = basesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      res.json(basesList);
    } catch (error) {
      logger.error("Ошибка получения списка баз из Firestore:", error);
      res.status(500).json({ error: "Не удалось получить список баз." });
    }
  }
);

app.post(
  "/api/logistics/bases",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { name, address } = req.body;
    if (!name || typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: "Название базы обязательно." });
    }
    if (!address || typeof address !== "string" || address.trim() === "") {
      return res.status(400).json({ error: "Адрес базы обязателен." });
    }

    try {
      const geocoded = await geocodeAddressOnServer(address.trim());
      if (!geocoded) {
        return res
          .status(400)
          .json({
            error: `Не удалось геокодировать адрес: ${address}. Проверьте корректность адреса.`,
          });
      }

      const newBaseData = {
        name: name.trim(),
        addressString: address.trim(),
        geocodedAddress: geocoded.geocodedAddress,
        lat: geocoded.lat,
        lon: geocoded.lon,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const newBaseRef = await db
        .collection("logistics_bases")
        .add(newBaseData);

      await db.collection("processed_activity_log").add({
        type: "base_added",
        baseId: newBaseRef.id,
        baseName: newBaseData.name,
        adminUserId: req.user.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info(
        `Добавлена база: ${newBaseData.name} по адресу: ${newBaseData.addressString} (ID: ${newBaseRef.id})`
      );
      res.status(201).json({ id: newBaseRef.id, ...newBaseData });
    } catch (error) {
      logger.error("Ошибка добавления базы в Firestore:", error);
      res.status(500).json({ error: "Не удалось добавить базу." });
    }
  }
);

let serverVehicles = [{ id: "vehicle_default_1", name: "Газель A123BC" }];
app.get("/api/logistics/vehicles", authenticateToken, isAdmin, (req, res) => {
  res.json(serverVehicles);
});
app.post("/api/logistics/vehicles", authenticateToken, isAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Название/номер ТС обязательно." });
  }
  const newVehicle = { id: `vehicle_${Date.now()}`, name: name.trim() };
  serverVehicles.push(newVehicle);
  logger.info(`Добавлено ТС: ${newVehicle.name}`);
  res.status(201).json(newVehicle);
});

app.get("/api/admin/orders", authenticateToken, isAdmin, async (req, res) => {
  try {
    const ordersRef = db.collection("orders");
    const snapshot = await ordersRef
      .where("status", "!=", "delivered")
      .orderBy("status")
      .orderBy("createdAt", "desc")
      .get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }
    const allOrders = snapshot.docs.map((doc) => {
      const orderData = doc.data();
      return {
        id: orderData.orderId,
        firestoreDocId: doc.id,
        userId: orderData.userId,
        userEmail: orderData.userEmail || "N/A",
        foods: orderData.foods,
        totalPrice: orderData.totalPrice,
        address: orderData.address,
        status: orderData.status,
        createdAt: orderData.createdAt
          .toDate()
          .toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }),
      };
    });
    res.status(200).json(allOrders);
  } catch (error) {
    logger.error("Ошибка при получении заказов для админа:", {
      error: error.message,
      stack: error.stack,
    });
    res
      .status(500)
      .json({
        error: "Внутренняя ошибка сервера при получении заказов для админа.",
      });
  }
});

app.put(
  "/api/admin/orders/:orderDocId/status",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { orderDocId } = req.params;
    const { status } = req.body;

    if (!orderDocId || !status) {
      return res
        .status(400)
        .json({ error: "ID заказа и новый статус обязательны." });
    }

    try {
      const orderRef = db.collection("orders").doc(orderDocId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        return res.status(404).json({ error: "Заказ не найден." });
      }

      await orderRef.update({ status: status });

      await db.collection("processed_activity_log").add({
        type: "order_status_update",
        orderId: orderDoc.data().orderId,
        orderDocId: orderDocId,
        newStatus: status,
        adminUserId: req.user.uid,
        adminEmail: req.user.email,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(
        `Статус заказа ${orderDoc.data().orderId} (Doc ID: ${orderDocId}) обновлен на "${status}" администратором ${req.user.email}`
      );
      res
        .status(200)
        .json({
          message: "Статус заказа успешно обновлен.",
          orderId: orderDoc.data().orderId,
          newStatus: status,
        });
    } catch (error) {
      logger.error(`Ошибка обновления статуса заказа ${orderDocId}:`, {
        error: error.message,
        stack: error.stack,
      });
      res
        .status(500)
        .json({
          error: "Внутренняя ошибка сервера при обновлении статуса заказа.",
        });
    }
  }
);

app.get(
  "/api/admin/activity-log",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    try {
      const logSnapshot = await db
        .collection("processed_activity_log")
        .orderBy("timestamp", "desc")
        .limit(100)
        .get();
      const logs = logSnapshot.docs.map((doc) => {
        const data = doc.data();
        const formattedTimestamp =
          data.timestamp && data.timestamp.toDate
            ? data.timestamp
                .toDate()
                .toLocaleString("ru-RU", {
                  dateStyle: "medium",
                  timeStyle: "medium",
                })
            : "N/A";
        return {
          id: doc.id,
          ...data,
          timestamp: formattedTimestamp,
        };
      });
      res.json(logs);
    } catch (error) {
      logger.error("Ошибка при получении журнала активности:", {
        error: error.message,
        stack: error.stack,
      });
      res
        .status(500)
        .json({ error: "Не удалось загрузить журнал активности." });
    }
  }
);

app.get(
  "/api/reports/orders-word",
  authenticateToken,
  isAdmin,
  async (req, res) => {
    const { year, month } = req.query;

    if (!year || !month || isNaN(parseInt(year)) || isNaN(parseInt(month))) {
      return res
        .status(400)
        .json({
          error: "Год и месяц (1-12) обязательны и должны быть числами.",
        });
    }

    const y = parseInt(year);
    const m = parseInt(month);

    if (m < 1 || m > 12) {
      return res.status(400).json({ error: "Месяц должен быть от 1 до 12." });
    }

    const startDate = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const endDate = new Date(y, m, 1, 0, 0, 0, 0);

    try {
      const ordersSnapshot = await db
        .collection("orders")
        .where("createdAt", ">=", startDate)
        .where("createdAt", "<", endDate)
        .orderBy("createdAt", "asc")
        .get();

      let totalRevenue = 0;
      let deliveredOrdersCount = 0;

      const ordersData = ordersSnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        totalRevenue += data.totalPrice || 0;
        if (data.status === "delivered") {
          deliveredOrdersCount++;
        }
        return {
          orderId: data.orderId || "N/A",
          createdAt: data.createdAt.toDate().toLocaleDateString("ru-RU"),
          totalPrice: data.totalPrice || 0,
          address: data.address || "Не указан",
          status: data.status || "N/A",
          userEmail: data.userEmail || "N/A",
        };
      });

      const routesSnapshot = await db
        .collection("processed_activity_log")
        .where("type", "==", "route_processing")
        .where("timestamp", ">=", startDate)
        .where("timestamp", "<", endDate)
        .get();

      let totalFuelCostForMonth = 0;
      routesSnapshot.forEach((doc) => {
        totalFuelCostForMonth += doc.data().calculatedFuelCost || 0;
      });

      const tableHeader = new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({ text: "ID Заказа", style: "tableHeader" }),
            ],
          }),
          new TableCell({
            children: [new Paragraph({ text: "Дата", style: "tableHeader" })],
          }),
          new TableCell({
            children: [
              new Paragraph({ text: "Email клиента", style: "tableHeader" }),
            ],
          }),
          new TableCell({
            children: [
              new Paragraph({ text: "Сумма (руб.)", style: "tableHeader" }),
            ],
          }),
          new TableCell({
            children: [new Paragraph({ text: "Адрес", style: "tableHeader" })],
          }),
          new TableCell({
            children: [new Paragraph({ text: "Статус", style: "tableHeader" })],
          }),
        ],
        tableHeader: true,
      });

      const dataRows = ordersData.map(
        (order) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph(String(order.orderId))],
              }),
              new TableCell({
                children: [new Paragraph(String(order.createdAt))],
              }),
              new TableCell({
                children: [new Paragraph(String(order.userEmail))],
              }),
              new TableCell({
                children: [new Paragraph(String(order.totalPrice.toFixed(2)))],
              }),
              new TableCell({
                children: [new Paragraph(String(order.address))],
              }),
              new TableCell({
                children: [new Paragraph(String(order.status))],
              }),
            ],
          })
      );

      const table = new Table({
        rows: [tableHeader, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
      });

      let logoImagePara = [];
      const logoPath = path.join(__dirname, "logo.png");
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoImagePara.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: logoBuffer,
                transformation: { width: 200, height: 67 },
              }),
            ],
            alignment: AlignmentType.CENTER,
          })
        );
      }

      const doc = new Document({
        styles: {
          paragraphStyles: [
            {
              id: "tableHeader",
              name: "Table Header Style",
              basedOn: "Normal",
              next: "Normal",
              run: { bold: true, size: 22 }, // 11pt
              paragraph: { spacing: { before: 120, after: 120 } },
            },
            {
              id: "summaryText",
              name: "Summary Text",
              basedOn: "Normal",
              run: { size: 24 }, // 12pt
              paragraph: { spacing: { before: 240, after: 120 } },
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              ...logoImagePara,
              new Paragraph({
                children: [
                  new TextRun({ text: "EasySelect", bold: true, size: 48 }),
                ], // 24pt
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 300 },
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    `Отчет по заказам за ${String(m).padStart(2, "0")}.${y}`
                  ),
                ],
                heading: HeadingLevel.HEADING_1,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
              }),
              new Paragraph({ text: "" }),
              new Paragraph({
                text: `Общее количество заказов: ${ordersData.length}`,
                style: "summaryText",
              }),
              new Paragraph({
                text: `Количество доставленных заказов: ${deliveredOrdersCount}`,
                style: "summaryText",
              }),
              new Paragraph({
                text: `Общая выручка по заказам: ${totalRevenue.toFixed(2)} руб.`,
                style: "summaryText",
              }),
              new Paragraph({
                text: `Общие затраты на топливо (по рассчитанным маршрутам): ${totalFuelCostForMonth.toFixed(2)} руб.`,
                style: "summaryText",
              }),
              new Paragraph({
                text: `Расчетная прибыль (Выручка - Топливо): ${(totalRevenue - totalFuelCostForMonth).toFixed(2)} руб. (без учета стоимости товаров и прочих расходов)`,
                style: "summaryText",
              }),
              new Paragraph({ text: "" }),
              ...(ordersData.length > 0
                ? [table]
                : [
                    new Paragraph("Нет данных по заказам за указанный период."),
                  ]),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      const fileName = `Отчет_EasySelect_заказы_${y}_${String(m).padStart(2, "0")}.docx`;
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.send(buffer);
    } catch (error) {
      logger.error("Ошибка при генерации отчета по заказам (Word):", {
        error: error.message,
        stack: error.stack,
        year,
        month,
      });
      if (
        error.message &&
        error.message.includes("The query requires an index.")
      ) {
        logger.error(
          "FIRESTORE INDEX REQUIRED for orders report. Check Firestore console for link to create index on 'createdAt' (ASC or DESC)."
        );
      }
      res
        .status(500)
        .json({ error: "Внутренняя ошибка сервера при генерации отчета." });
    }
  }
);

const PORT = process.env.PORT || 8080;

const keepAlive = () => {
  const pingUrl = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/ping`
    : `http://localhost:${PORT}/ping`;
  setInterval(
    async () => {
      try {
        await axios.get(pingUrl);
      } catch (error) {
        logger.warn(`Keep-alive ping failed for ${pingUrl}: ${error.message}`);
      }
    },
    14 * 60 * 1000
  );
};

app.use((err, req, res, next) => {
  logger.error("Необработанная ошибка Express:", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
  });
  res.status(500).json({ error: "Внутренняя ошибка сервера." });
});

app.listen(PORT, () => {
  logger.info(`Сервер запущен на порту ${PORT}`);
  logger.info(`URL OSRM: ${OSRM_URL}`);
  logger.info(`Цена топлива: ${FUEL_PRICE}`);
  logger.info(`Расход топлива: ${FUEL_CONSUMPTION_RATE} л/100км`);
  if (process.env.NODE_ENV !== "development") {
    keepAlive();
  }
});

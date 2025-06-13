// backend/index.js

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const {admin, db, bucket } = require("./firebase-admin");

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// === Webhook da Kiwify ===
app.post("/webhook/kiwify", async (req, res) => {


  const { buyer_email, product_name } = req.body;

    

  if (!buyer_email || !product_name) {
    return res.status(400).send("Campos obrigatórios ausentes.");
  }

  let creditsToAdd = 0;
  if (product_name === "Creditos magify") creditsToAdd = 6;
  else if (product_name === "creditosmagify") creditsToAdd = 5;
  else return res.status(400).send("Produto inválido.");

  try {
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("email", "==", buyer_email).limit(1).get();

    if (snapshot.empty) {
      await usersRef.add({ email: buyer_email, credits: creditsToAdd });
    } else {
      const userRef = snapshot.docs[0].ref;
      await userRef.update({
        credits: admin.firestore.FieldValue.increment(creditsToAdd),
      });
    }

    res.status(200).send("Créditos adicionados com sucesso.");
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).send("Erro interno no servidor.");
  }
});

// === Rota para gerar imagem estilo mangá ===
app.post("/generate-manga", upload.single("file"), async (req, res) => {
  const filePath = req.file.path;
  const uid  = req.body.uid;

  console.log(uid)

  try {
    const base64Image = fs.readFileSync(filePath, { encoding: "base64" });
    const imageData = `data:image/jpeg;base64,${base64Image}`;

  const output = await replicate.run(
      "black-forest-labs/flux-kontext-pro",
      {
        input: {
          prompt:"Make this a 90s cartoon",
          input_image: imageData,
          output_format: "jpg"
        }
      }
    );

// Transforma ReadableStream em buffer
const stream = output;
const chunks = [];
for await (const chunk of stream) {
  chunks.push(Buffer.from(chunk));
}
const buffer = Buffer.concat(chunks);

// Salva como arquivo temporário
const tempFilePath = path.join(os.tmpdir(), `output-${uuidv4()}.jpg`);
fs.writeFileSync(tempFilePath, buffer);

// Envia ao Firebase Storage
const storageFileName = `users/${uid}/output-${Date.now()}.jpg`;
await bucket.upload(tempFilePath, {
  destination: storageFileName,
  metadata: {
    contentType: "image/jpeg",
  },
});

const file = bucket.file(storageFileName);
const [url] = await file.getSignedUrl({
  action: "read",
  expires: "03-09-2026",
});



// Limpa arquivos temporários
fs.unlinkSync(filePath);
fs.unlinkSync(tempFilePath);

res.status(200).json({ imageUrl: url });

    console.log("🔥 OUTPUT DA REPLICATE:", output);

   if (!output || !Array.isArray(output) || !output[0]) {
  throw new Error("A Replicate não retornou uma URL válida.");
}
const imageUrlFromReplicate = output[0];

    // Baixa a imagem temporariamente
  
    const response = await fetch(imageUrlFromReplicate);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

    const firebasePath = `users/${uid}/manga-${Date.now()}.jpg`;
    await bucket.upload(tempFilePath, {
      destination: firebasePath,
      metadata: {
        contentType: "image/jpeg",
      },
    });


    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "03-09-2026",
    });

    fs.unlinkSync(filePath);
    fs.unlinkSync(tempFilePath);

    res.status(200).json({ imageUrl: signedUrl });
  } catch (error) {
    console.error("Erro ao gerar ou salvar imagem:", error);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ message: "Erro ao gerar imagem com IA" });
  }
});

// === Endpoint para consumir crédito ===
app.post("/use-credit/:uid", async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.status(400).send("UID ausente.");

  const userRef = db.collection("users").doc(uid);
  const docSnap = await userRef.get();

  if (!docSnap.exists) return res.status(404).send("Usuário não encontrado.");

  const data = docSnap.data();
  if (data.credits > 0) {
    await userRef.update({ credits: admin.firestore.FieldValue.increment(-1) });
    return res.status(200).send({ success: true, message: "Crédito consumido." });
  } else {
    return res.status(403).send({ success: false, message: "Créditos insuficientes." });
  }
});

// === Consultar créditos ===
app.get("/credits/:uid", async (req, res) => {
  const { uid } = req.params;
  const userRef = db.collection("users").doc(uid);
  const docSnap = await userRef.get();

  if (!docSnap.exists) return res.status(404).send("Usuário não encontrado.");

  const { credits } = docSnap.data();
  res.send({ credits });
});

// Rota para retornar o histórico de imagens geradas por um usuário
app.get("/history/:uid", async (req, res) => {
  const { uid } = req.params;


  try {
    const snapshot = await db
      .collection("users")
      .doc(uid)
      .collection("history")
      .orderBy("createdAt", "desc")
      .get();

    const history = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(history)

    res.status(200).json({ history });
  } catch (error) {
    console.error("Erro ao buscar histórico:", error);
    res.status(500).json({ message: "Erro ao buscar histórico do usuário." });
  }
});


// === Inicia o servidor ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

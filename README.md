# ตัวบนหัว (Heads Up Game) - Multiplayer Web App

เกมทายตัวละครบนหัวแบบหลายคน ผลัดกันเล่นคนละเครื่องผ่านห้องเดียวกัน (สุ่มตัวละคร ซ่อนความลับ มีข้อมูลช่วยตอบ จับเวลา และสรุปอันดับ)

---

## การเอาขึ้น Render.com (ฟรี & ง่ายมาก)

### วิธีที่ 1: ใช้ Blueprint (แนะนำ - ง่ายสุด)
1. นำโค้ดขึ้น GitHub repository ของคุณ
2. เข้าเว็บ [render.com](https://render.com) แล้วล็อกอิน
3. กด **New +** -> เลือก **Blueprint**
4. เลือก repository ของคุณ ระบบจะอ่านการตั้งค่าจากไฟล์ `render.yaml` ให้อัตโนมัติทันที
5. กด **Apply** รอ 1-2 นาที คุณจะได้ URL `https://xxxx.onrender.com` เอาไปแชร์ให้เพื่อนเล่นได้เลย

---

### วิธีที่ 2: สร้าง Web Service เองแบบ Manual
ถ้าไม่ได้ใช้ Blueprint ให้สร้างแบบ Web Service:
- **Type:** Web Service
- **Environment:** `Node`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`
- **Health Check Path (ถ้ามี):** `/health`

> **หมายเหตุ:** Render รองรับ WebSocket (WSS) แบบฟรีอยู่แล้ว ไม่ต้องตั้งค่าอะไรเพิ่มเติม เมื่อเข้าผ่าน HTTPS เว็บจะเชื่อมต่อ `wss://` ให้อัตโนมัติ

---

## การรันบนเครื่อง Local (ทดสอบในบ้าน)
```bash
# ติดตั้ง dependencies
npm install

# รันโหมด Development (พอร์ต 5173)
npm run dev

# หรือ Build & รัน Production (พอร์ต 3000)
npm run build
npm start
```

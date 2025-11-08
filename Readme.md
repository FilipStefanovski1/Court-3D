# 🏀 Basketboard

Basketboard is a small 3D basketball tactics board built with **Three.js** and **Vite**.  
You can place players, draw plays, move around the court, and save or load your plays locally.  

---

## ✨ Features
- 🧍 Place player markers anywhere on the 3D court  
- ✏️ Draw routes and tactics directly on the court surface  
- 🖐️ Move mode allows free rotation and panning  
- 🔙 Undo or clear all drawings  
- 💾 Save and load plays stored locally in your browser  
- 💡 Built completely client-side, no backend needed  

---

## ⚙️ Tech Stack
**Frontend:** HTML + CSS + JavaScript  
**3D Engine:** [Three.js](https://threejs.org/)  
**Dev Server:** [Vite](https://vitejs.dev/)  
**File Format:** GLB (court model)  
**IDE:** Visual Studio Code  

---

## 🧩 Installation & Running Locally

### 1️⃣ Clone the repository
git clone https://github.com/FilipStefanovski1/Court-3D.git
cd basketboard  # (if you’re not already inside the folder)

## install the dependencies
npm install
npm run dev
Vite will give you a local link, usually http://localhost:5173/
Open that link in your browser to use the app.

## 🧠 How it works 
- Place Mode= drop or move player circles
- Draw Mode= hold and drag to draw a path
- Move Mode= rotate and pan the 3D camera
- Undo / Clear= remove your last action or reset
- Save / Load= save a play like "Pick n Roll" and load it back anytime


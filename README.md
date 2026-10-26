# Rotación — Romero Panificados

App individual para la rotación de mantenimiento (calendario mensual, personas, grupos, excepciones y configuración).
HTML + CSS + JS puro, sin build ni Node. Datos en Firestore (`planning/config`), en tiempo real.

## Acceso (igual que la app de Calidad)
Pantalla de login con **Rol + Usuario + Contraseña**. Los usuarios están escritos en `js/firebase.js` (`USERS`).

| Rol | Usuario | Puede |
|---|---|---|
| ⚙️ Admin | `admin` | todo: grupos, personas, excepciones, rotaciones |
| ⚙️ Admin | `Sergio` | todo, igual que admin |
| 👁️ Visualizador | `mtto` | solo ver el calendario |

El usuario no distingue mayúsculas (`Sergio` = `sergio`). Para agregar o cambiar un usuario se edita `USERS`.

## Estructura
```
index.html
css/styles.css
js/firebase.js     config de Firebase + USERS
js/app.js          lógica del planning
firestore.rules
render.yaml
```

## 1. Probar en local
Abrir la carpeta en VS Code → clic derecho en `index.html` → **Open with Live Server**.

## 2. Firebase
Solo hace falta Firestore (no se usa Authentication):
**Firestore Database → Rules** → agregar el bloque `match /planning/...` de `firestore.rules` (sin pisar las reglas de las otras apps) → **Publish**.

Primer uso: entrar como Admin → **CARGAR LOS 3 GRUPOS DE MANTENIMIENTO** (si la base está vacía).

## 3. GitHub
```bash
cd planning-romero
git init
git add .
git commit -m "Planning Romero v1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/planning-romero.git
git push -u origin main
```

## 4. Render
**New → Static Site** → conectar el repo →
- Build Command: *(vacío)*
- Publish Directory: `.`

Cada `git push` redeploya solo. (También está `render.yaml` por si preferís Blueprint.)

## Ojo con la seguridad
Como en el resto de las apps de la suite, el login se valida en el navegador: las contraseñas de `USERS` quedan a la vista de quien abra el código de la página, y las reglas de Firestore dejan leer y escribir `planning` sin autenticación. Alcanza para una herramienta interna, pero no protege los datos de alguien que sepa dónde mirar.

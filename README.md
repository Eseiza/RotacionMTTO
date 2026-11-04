# Rotación — Romero Panificados

App individual para la rotación de mantenimiento (calendario mensual, personas, horarios, grupos, excepciones, compensatorios y configuración).

**Qué es automático y qué es manual**
- Automático: el turno que le toca a cada grupo cada semana (según el *orden de rotación*, editable en CONFIGURACIÓN) y los compensatorios.
- Manual: entrada, salida y turno de cada día o rango de fechas (vista HORARIOS, o clic en una celda del calendario).
- Por turno: día en que **arranca** y día en que **termina** (vista HORARIOS → Turnos). Cada turno tiene su botón, y se pueden agregar turnos nuevos con el mismo botón. Sin valores propios, el turno usa la semana base de CONFIGURACIÓN.
- Por persona: días de la semana que viene y corrimiento de horario (entra X horas antes/después; mueve entrada y salida juntas, así sigue haciendo las mismas horas).
- Historial: cada cambio guardado en el orden/configuración de rotación, en la configuración horaria de una persona o en los horarios de grupo conserva el antes y el después, con fecha y usuario. Se consulta en la vista HISTORIAL. Los registros se guardan en la subcolección `planning/config/history`, separados del documento operativo para evitar el límite de tamaño de Firestore.
- Día libre trabajado: es únicamente una excepción que suma compensatorio. No pide turno ni horas, no crea horarios y elimina solo las fechas afectadas de cualquier rango horario, conservando los días anteriores y posteriores. Esta regla también limpia registros antiguos al cargar la configuración.
HTML + CSS + JS puro, sin build ni Node. Datos en Firestore (`planning/config`), en tiempo real.

## Acceso 
Pantalla de login con **Rol + Usuario + Contraseña**. Los usuarios están escritos en `js/firebase.js` (`USERS`).

| Rol | Usuario | Puede |
|---|---|---|
| ⚙️ Admin | `admin` | todo: grupos, personas, horarios, excepciones, rotaciones |
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
**Firestore Database → Rules** → agregar los bloques `match /planning/...` y su subcolección `history` de `firestore.rules` (sin pisar las reglas de las otras apps) → **Publish**.

Primer uso: entrar como Admin → crear los grupos (GRUPOS) y las personas (PERSONAS). No hay grupos ni personas cargados en el código.

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
El acceso actual es un control visual en el navegador, no autenticación real: los usuarios/contraseñas están definidos en `js/firebase.js` y las reglas de `firestore.rules` permiten leer y escribir `planning` sin autenticación. Por eso no debe considerarse una protección de datos ni publicarse con información sensible. Para producción hay que migrar el acceso a Firebase Authentication y restringir Firestore por usuario/rol; hacerlo requiere configurar las cuentas y reglas del proyecto Firebase.

## Validaciones y consistencia de datos
- Los rangos horarios se recortan por fecha sin borrar los días que quedan fuera del cambio.
- Los horarios manuales no pueden volver a ocupar fechas marcadas como `trabajo_franco`.
- La rotación valida fechas, días de semana, turnos y corrimientos al cargar los datos.
- Los horarios de grupo respetan tanto los días definidos para el turno como los días habituales de asistencia de cada persona.

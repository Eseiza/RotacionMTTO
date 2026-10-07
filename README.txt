PLANNING DE MANTENIMIENTO - ROMERO
=================================

LOGIN SIN CORREO
----------------
El sistema NO usa correos para el login.
El usuario solamente escribe:
- Usuario
- Contraseña
El rol (Admin / MTTO) se detecta solo a partir del usuario.

La autenticación se hace en el servidor de Render y luego se genera un Firebase Custom Token.
Firebase Authentication NO usa Email/Password para estos usuarios.

USUARIOS POR DEFECTO
--------------------
Admin:
  usuario: admin
  rol: admin

MTTO:
  usuario: mtto
  rol: mantenimiento

Para probar el proyecto sin variables de entorno, las claves por defecto son:
  admin → admin123
  mtto → mtto123

EN PRODUCCIÓN cambiá estas claves en las variables de entorno de Render. Se configuran como:
  ADMIN_PASSWORD
  MTTO_PASSWORD

Podés cambiar también los nombres de usuario con:
  ADMIN_USERNAME
  MTTO_USERNAME

PRUEBA LOCAL
------------
Live Server solo sirve archivos: NO atiende /api/login. Para probar:
1. Descargá la clave de Firebase (Cuentas de servicio -> Generar nueva clave privada)
   y guardala como serviceAccountKey.json junto a server.js (no la subas a Git ni al ZIP).
2. En la carpeta del proyecto: npm install  y  npm start
3. Abrí http://localhost:3000  (recomendado)
   Si preferís Live Server, también funciona mientras "npm start" esté corriendo:
   el login se envía automáticamente a http://localhost:3000.
Usuarios por defecto: admin / admin123  y  mtto / mtto123

RENDER
------
1. Subí este proyecto a un repositorio Git o conectá el ZIP mediante tu flujo habitual.
2. Servicio: Web Service / Node.
3. Build Command: npm install
4. Start Command: npm start
5. Variables de entorno obligatorias:

FIREBASE_SERVICE_ACCOUNT_JSON = contenido completo del JSON de una cuenta de servicio de Firebase.
FIREBASE_DATABASE_URL = https://rotacionmtto-default-rtdb.firebaseio.com
ADMIN_USERNAME = admin
ADMIN_PASSWORD = TU_CLAVE_ADMIN
MTTO_USERNAME = mtto
MTTO_PASSWORD = TU_CLAVE_MTTO

FIREBASE SERVICE ACCOUNT
------------------------
Firebase Console -> Configuración del proyecto -> Cuentas de servicio -> Generar nueva clave privada.
Copiá TODO el JSON en FIREBASE_SERVICE_ACCOUNT_JSON de Render.
NO lo subas al repositorio ni al ZIP.

FIREBASE WEB CONFIG
-------------------
js/firebase-config.js contiene solamente la configuración pública de la app web.
No contiene la cuenta de servicio.

REALTIME DATABASE RULES
-----------------------
Usá firebase-rules.json.
Las reglas usan auth.token.role:
- admin: lectura/escritura de appData y calendario.
- mantenimiento: solamente lectura de calendar.

ESTRUCTURA
----------
appData/
  grupos, personas, excepciones, configuración...

calendar/
  YYYY-MM/
    calendario publicado del mes

SEGURIDAD
---------
No hay correos, correos técnicos ni contraseñas en el frontend.
Las credenciales de los dos perfiles quedan en variables de entorno del servidor.
El servidor crea el Custom Token de Firebase con el claim role.

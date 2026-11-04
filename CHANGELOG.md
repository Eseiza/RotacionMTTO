# Cambios — Romero Rotación v11

- Calendario: la raya blanca ya no marca los horarios corridos. Ahora aparece solo en la celda de quien hace el arranque de fábrica: el que entra primero de su grupo ese día. Si dos entran a la misma hora, no se marca ninguno. Se agregó a la leyenda.

# Cambios — Romero Rotación v10

## Turnos con botón propio
- CONFIGURACIÓN ya no usa un selector: cada turno (Mañana, Tarde, Noche y los que se agreguen) tiene su bloque con un botón «ARRANCA X · TERMINA Y» que abre la edición de sus días.
- HORARIOS → Horarios de grupos: dentro de cada turno de cada grupo hay un botón «ARRANCA X · TERMINA Y» y un botón EDITAR que modifica solo ese turno sin tocar los demás (EDITAR TODOS mantiene la edición completa).
- Los turnos nuevos aparecen automáticamente con su botón en todos esos lugares.

# Cambios — Romero Rotación v9

## Historial de cambios
- Se conserva la versión anterior y la nueva cada vez que se modifica el orden o la configuración del ciclo de rotación.
- Se conserva el antes/después de la configuración horaria individual de cada persona, incluidos horarios fijos, días de asistencia, corrimientos y rangos horarios manuales.
- También se registra el antes/después de los horarios de grupo y de sus turnos de referencia, porque afectan a las personas asignadas.
- Cada registro incluye fecha, hora y usuario que realizó el cambio.
- Se agregó la vista HISTORIAL para consultar los cambios cronológicamente.
- El historial se guarda en `planning/config/history`, una subcolección de Firestore, y el guardado de los cambios operativos y sus eventos de historial se realiza en un único batch atómico. Así no se llena el documento principal ni se pierde el historial al actualizar la configuración.

## Comportamiento preservado de v8

## Consistencia y edición
- `Trabajó día libre` queda como excepción de compensación: no solicita turno ni entrada/salida y no genera horarios.
- Al marcar un rango como día libre trabajado, se eliminan únicamente las fechas afectadas de los rangos horarios individuales; los días anteriores y posteriores se conservan.
- Al editar un día individual dentro de un rango, se recorta ese día sin borrar el resto del rango horario o de la excepción.
- Los horarios nuevos respetan las excepciones `trabajo_franco` existentes y no pueden volver a registrar horas en esas fechas.
- Al cargar datos anteriores, se limpian los horarios incompatibles con días libres trabajados; la migración se persiste cuando ingresa un administrador.

## Calidad de datos y operación
- Normalización de fechas, días de semana, modalidades, corrimientos y horarios de grupo.
- Los horarios de grupo también respetan los días habituales de asistencia de cada persona.
- Al eliminar un turno, se actualizan las referencias de horarios individuales, cambios de turno, personas y grupos.
- Al eliminar un grupo, se quitan los cambios de grupo que apuntaban a ese grupo.
- Se agregaron validaciones de nombres y selecciones obligatorias.
- Si Firebase rechaza un guardado, se restaura el último estado confirmado en lugar de dejar cambios locales aparentando haberse guardado.

## Validación realizada
- Sintaxis JavaScript (`app.js` y `firebase.js`).
- Parseo de HTML y balance de llaves CSS.
- Pruebas de regresión de recorte de rangos horarios y excepciones.

No se pudo verificar una sesión real contra Firebase ni una prueba interactiva completa en navegador desde este entorno.

# Herramienta de Selección de Tema de Tesis

Aplicación estática para registrar hasta tres propuestas por estudiante, calificarlas con una rúbrica de cinco criterios y mostrar un ranking actualizado en tiempo real.

## Rúbrica y puntaje

Cada evaluación suma un máximo de 100 puntos. Las notas van del 1 al 10 y se convierten según este peso:

| Criterio | Peso |
|---|---:|
| Pertinencia con la carrera | 20 puntos |
| Manejo del tema | 15 puntos |
| Delimitación | 20 puntos |
| Facilidad para investigarlo | 25 puntos |
| Aporte del estudio | 20 puntos |

El ranking calcula el promedio de las evaluaciones recibidas por cada tema. El voto del tutor se incluye con el mismo peso que cada participante.

## Configurar Firebase

1. Crea un proyecto Firebase nuevo y registra una aplicación web.
2. Cloud Firestore Standard está creado en `northamerica-south1` (México).
3. En Authentication, activa **Anonymous** para crear una identidad persistente por navegador.
4. Copia la configuración web del proyecto en `firebase-config.js` y el ID del proyecto en `.firebaserc`.
5. La sesión de tutor queda vinculada al UID anónimo persistente del navegador autorizado; conserva los datos de este navegador para mantener el acceso.
6. Sustituye `REPLACE_WITH_TUTOR_UID` en `firebase-config.js` y `firestore.rules` por ese UID.
7. Publica las reglas: `firebase deploy --only firestore:rules`.
8. En Authentication → Settings → Authorized domains, agrega `silviotif89.github.io` y `localhost`.

La configuración web incluye una clave pública de Firebase. Los datos se protegen mediante Authentication y `firestore.rules`; no añadas claves de cuenta de servicio ni credenciales privadas a este repositorio.

## Publicar en GitHub Pages

El flujo `.github/workflows/pages.yml` publica el sitio en cada actualización de `main`. En la configuración del repositorio, selecciona **Settings → Pages → Build and deployment → GitHub Actions**. El repositorio debe ser público si la cuenta no tiene un plan que permita GitHub Pages desde repositorios privados.

## Uso de la sesión

- El tutor agrega los nombres y abre el registro de propuestas.
- Cada estudiante selecciona su nombre y guarda hasta tres temas.
- El tutor abre la votación cuando la lista está lista.
- Las participantes y el tutor evalúan los temas; el ranking se actualiza sin recargar la página.
- El tutor cierra la sesión al terminar.

## Acceso a la sesión

La página y los datos de la actividad son accesibles para quien tenga el enlace. Cada navegador usa una identidad anónima y puede votar una vez por tema en esa sesión; Firebase no verifica que la persona haya elegido su propio nombre. Comparte el enlace solo con el grupo.


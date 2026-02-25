---
name: firebase-functions-initializer
description: Inicializa un proyecto de Firebase Cloud Functions, elimina el código autogenerado y deja un simple "Hola Mundo".
---

# Inicializador de Firebase Cloud Functions

Esta habilidad (skill) guía al agente para inicializar correctamente un proyecto de Firebase Cloud Functions, eliminando los comentarios y el código de ejemplo que se genera automáticamente, y dejando en su lugar únicamente un simple "Hola Mundo".

## When to use this skill

- Cuando el usuario pida crear o inicializar un proyecto de Cloud Functions de Firebase.
- Cuando necesites un entorno limpio de funciones en la nube (backend) usando Firebase, sin el *boilerplate* por defecto.

## How to use it

Sigue estos pasos estrictamente para inicializar las Cloud Functions de Firebase:

### 1. Ejecutar la Inicialización
- Utiliza la herramienta de línea de comandos de Firebase para inicializar el proyecto de funciones usando **JavaScript**, NO TypeScript. Esto generalmente implica ejecutar `firebase init functions` seleccionando JavaScript.
- Instala las dependencias requeridas (como `firebase-functions` y `firebase-admin`).

### 2. Eliminar el Código Autogenerado
- Navega al directorio de funciones (`functions/`).
- Localiza el archivo de entrada principal (`index.js`).
- Elimina **todo** el código, incluyendo el código comentado y los ejemplos que Firebase genera por defecto.

### 3. Implementar "Hola Mundo" con Firestore
- Escribe una función HTTP básica en `index.js` que retorne un "Hola Mundo".
- Asegúrate de importar e inicializar **Firestore** utilizando `firebase-admin`.

**Ejemplo (`index.js`):**
```javascript
const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.helloWorld = functions.https.onRequest((request, response) => {
  response.send("hola mundo");
});
```

### 4. Validar el Entorno
- Asegúrate de que no haya otros archivos de ejemplo y que el `package.json` esté correctamente configurado.
- Confírmale al usuario que el proyecto base ha sido configurado correctamente y que el código inicial autogenerado ha sido reemplazado por la función solicitada.

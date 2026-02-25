---
name: dart-package-initializer
description: Initializes a new Dart package project, sets up Git, and guides the user to push to a remote repository.
---

# Dart Package Initializer

This skill automates the creation of a new Dart package project. It handles project generation, Git initialization, and remote repository setup.

## When to use this skill

- When the user asks to "create a dart package" or "start a new dart library".
- When the user needs a new Dart project that is NOT a Flutter app.
- When the user wants to "inicializar un paquete de dart".

## How to use it

Follow these steps to create and setup the Dart package.
**IMPORTANT**: The user prefers to be spoken to in **Spanish**.

### 1. Project Creation
1.  Ask for the package name if not provided.
2.  Run `dart create -t package <package_name>`.
3.  **Critical**: `cd` into the new directory (`cd <package_name>`).

### 2. Git Initialization
1.  Run `git init -b main`.
2.  Run `git add .`.
3.  Run `git commit -m "Initial commit"`.

### 3. Remote Setup
**Note**: `gh` CLI is likely not available or configured.
1.  Ask the user to create an empty repository on their Git provider (GitHub/GitLab) and provide the URL.
    - Example: "He creado el proyecto y el repositorio local. Por favor, crea un repositorio vacío en GitHub/GitLab y dame la URL para subir el código."
2.  Once the user provides the URL:
    - `git remote add origin <url>`
    - `git push -u origin main`

### 4. Final Confirmation
Notify the user that the package is ready.
- Example: "Listo. Tu paquete Dart '<package_name>' ha sido creado y subido al repositorio remoto."

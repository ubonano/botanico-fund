---
name: flutter-initializer
description: Initialize a new clean Flutter project with specific architecture and configuration.
---

# Flutter Project Initializer

This skill automates the creation of a new Flutter project conformant to specific standards: clean slate (only main.dart), Web support, GetIt dependency, and a specific scalable folder structure.

## When to use this skill

- When the user asks to create a new Flutter project.
- When the user asks to initialize a project with "clean architecture" or standard setup.
- When the user references the "flutter-initializer" skill.

## How to use it

Follow these steps exactly to initialize the project. If any step fails, stop and ask the user.
**IMPORTANT**: The user prefers to be spoken to in **Spanish**. All your output messages and questions to the user should be in Spanish.

### 1. Request Project Name
If the user hasn't provided a project name in their request, ask for it (e.g., "¿Cómo te gustaría llamar al proyecto?").

### 2. Initialize Project
Run the following command to create the project with Web support enabled:
`flutter create --platforms web,android,ios <project_name>`

### 3. Clean and Structure Directory
1.  **Remove Default Files**: Delete the default `lib/main.dart` and `test/widget_test.dart` (and any other files in `lib/`).
2.  **Create Folder Structure**: Ensure the following directory structure exists inside `lib/`:
    ```text
    lib/
    ├── core/
    │   ├── config/
    │   │   ├── secret/
    │   │   └── locator.dart
    │   ├── models/
    │   ├── services/
    │   └── shared/
    ├── features/
    ├── app.dart
    └── main.dart
    ```

### 4. Setup Dependencies
1.  Add `get_it` and Firebase packages to `pubspec.yaml`. Run:
    ```bash
    flutter pub add get_it firebase_core firebase_auth cloud_firestore
    ```
2.  Run `flutter pub get`.

### 5. Create Configuration Files

**`lib/core/config/secret/firebase_options.dart`**:
*Create this file with dummy values so the project compiles. The user must replace it later.*
```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return const FirebaseOptions(
        apiKey: 'demo-api-key',
        appId: 'demo-app-id',
        messagingSenderId: 'demo-sender-id',
        projectId: 'demo-project-id',
      );
    }
    // TODO: Add other platforms (Android/iOS) via flutterfire configure
    throw UnsupportedError(
      'DefaultFirebaseOptions are not supported for this platform.',
    );
  }
}
```

**`lib/core/config/locator.dart`**:
```dart
import 'package:get_it/get_it.dart';

final GetIt locator = GetIt.instance;

void setupLocator() {
  // TODO: Register services and models here
}
```

### 6. Create Entry Points

**`lib/app.dart`**:
```dart
import 'package:flutter/material.dart';

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Material App',
      home: Scaffold(
        appBar: AppBar(
          title: const Text('Material App Bar'),
        ),
        body: const Center(
          child: Text('Hola Mundo'),
        ),
      ),
    );
  }
}
```

**`lib/main.dart`**:
```dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart'; // For kDebugMode
import 'app.dart';
import 'core/config/locator.dart';
import 'core/config/secret/firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // Setup Firebase Emulators in Debug Mode
  if (kDebugMode) {
    try {
      await FirebaseAuth.instance.useAuthEmulator('localhost', 9099);
      FirebaseFirestore.instance.useFirestoreEmulator('localhost', 8080);
      print('Connected to Firebase Emulators');
    } catch (e) {
      print('Error connecting to Firebase Emulators: $e');
    }
  }

  setupLocator();
  runApp(const MyApp());
}
```

### 7. Configure Git
1.  Initialize git: `git init` (if not already initialized).
2.  Update `.gitignore` to exclude the secret folder. Append this line to `.gitignore`:
    ```text
    lib/core/config/secret/
    ```

### 8. Add Project Rules
1.  Create the directory `.agent/rules/`: `mkdir -p .agent/rules`
2.  Create the file `.agent/rules/project_rules.md` with the following content:
    ```markdown
    ---
    description: "General project rules, architecture, and code conventions."
    globs: "**/*.dart"
    ---
    # Rules: Flutter Project Standards

    ## 1. Project Context
    - **Framework**: Flutter (Web, Android, iOS)
    - **Language**: Dart
    - **Architecture**: Feature-based Clean Architecture.
        - `lib/core/`: Shared resources, services, and config.
        - `lib/features/`: Isolated features with their own logic/UI.
    - **Dependency Injection**: `get_it` (via `locator.dart`).
    - **Backend**: Firebase (Core, Auth, Firestore).

    ## 2. Tech Stack & Libraries
    - **GetIt**: For service locator/dependency injection.
    - **Firebase**:
        - `firebase_core`, `firebase_auth`, `cloud_firestore`.
        - **Emulators**: MUST be used for local development (Auth: 9099, Firestore: 8080).
        - **Credentials**: `firebase_options.dart` MUST be placed in `lib/core/config/secret/`.

    ## 3. Code Conventions (CRITICAL)
    - **Clean Code**:
        - Variables and functions must have descriptive, English names.
        - Functions should be small and do one thing well.
    - **DRY (Don't Repeat Yourself)**:
        - Never duplicate logic. Extract to `core/shared` or feature-specific utilities.
    - **Widgets**:
        - Split large build methods into smaller private widgets or separate files.
    - **formatting**:
        - Always use trailing commas for better formatting.

    ## 4. Agent Behavior
    - **Refactoring**: If you see messy code, propose a refactor immediately.
    - **Language**: logic/comments in English. User communication in **Spanish** (as per global user preference).
    ```

### 9. Final Verification
- Notify the user (in Spanish) that the project has been successfully initialized (e.g., "El proyecto '<nombre>' se ha creado correctamente con la estructura solicitada.").

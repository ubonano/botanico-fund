---
name: dart-documentation-standard
description: Comprehensive guide for documenting Dart and Flutter code to ensure perfect understanding by third-party developers.
---

# Dart Documentation Standard

This skill defines the rigorous standard for documenting Dart and Flutter code. The primary goal is to make the codebase perfectly understandable for developers who did not write it. Documentation must be exhaustive, clear, and focused on the "why" and "how to use," not just the "what."

## When to use this skill

-   When the user asks to "document code" or "add comments."
-   When refactoring legacy code to improve maintainability.
-   When creating new public APIs, classes, or widgets.
-   When the user explicitly mentions "making code understandable for others."

## Core Philosophy

> "Code tells you *how* it does it. Comments tell you *why* it does it."
> "Documentation tells you *how to use it*."

We follow **Effective Dart: Documentation**, but with stricter requirements for clarity and completeness. Assume the reader knows Dart but knows *nothing* about the specific business logic or architectural decisions of this project.

## 1. Doc Comments (`///`)

ALWAYS use `///` doc comments for all members (public and private) when applying this skill, unless the implementation is trivally obvious (e.g., a getter that just returns a private field with a matching name).

**Do NOT use Block Comments (`/* ... */`) for documentation.**

## 2. Structure of Documentation

Every doc comment must follow this structure:

1.  **Summary Sentence**: A single, concise line ending in a period. It should be written in the third person singular (e.g., "Calculates..." not "Calculate...").
2.  **Blank Line**: Separate the summary from the details.
3.  **Detailed Explanation**: Paragraphs explaining:
    -   **Context**: When and why to use this class/method.
    -   **Behavior**: Key logic or algorithms used.
    -   **Contracts**: Preconditions (what must be true before calling) and Postconditions (what is guaranteed after).
4.  **Parameters & Returns**: Explicitly explain complex parameters or return values if the name isn't enough.
5.  **Exceptions**: List any errors that might be thrown.

## 3. Detailed Guidelines

### Classes

Document what the class represents and its main responsibility.

**Example:**
```dart
/// Manages the authentication state of the user.
///
/// This singleton class listens to Firebase Auth changes and notifies
/// listeners when a user logs in or out. It also handles token refreshing
/// automatically in the background.
///
/// Use [instance] to access the global state.
class AuthManager { ... }
```

### Methods and Functions

Focus on what the caller gets out of it and any side effects.

-   Start with a verb in third person singular: "Returns", "Update", "Fetches".
-   Mention if it performs network requests, database writes, or heavy computations.

**Example:**
```dart
/// Fetches the user's profile data from the remote server.
///
/// If the data is cached locally and is less than 5 minutes old,
/// the cached version is returned immediately to safe bandwidth.
///
/// Throws a [NetworkException] if the device is offline.
/// Returns `null` if the user does not have a profile set up.
Future<UserProfile?> fetchUserProfile(String userId) async { ... }
```

### Parameters

Don't just repeat the type. Explain constraints (e.g., "must be non-negative", "cannot be null").

**Bad:** `/// [timeout] The timeout.`
**Good:** `/// [timeout] The maximum duration to wait before cancelling the request. If null, waits indefinitely.`

### Boolean Properties

For booleans, explain what happens when `true` AND when `false`.

**Example:**
```dart
/// Whether the user has enabled push notifications.
///
/// If `true`, the app will register with APNs/FCM on startup.
/// If `false`, no tokens will be requested.
final bool notificationsEnabled;
```

## 4. Do's and Don'ts

| DO | DON'T |
| :--- | :--- |
| **DO** use markdown for formatting (`[variable]`, `*emphasis*`, `` `code` ``). | **DON'T** write plain text references that get lost. |
| **DO** explain *why* a weird logic exists (e.g., "Workaround for API bug #123"). | **DON'T** leave complex code blocks unexplained. |
| **DO** be redundant if it adds clarity for a newcomer. | **DON'T** be redundant if it adds noise (e.g., `/// Constructor` on a constructor). |
| **DO** link to other classes using brackets `[ClassName]`. | **DON'T** assume the user knows where to look next. |

## 5. Verification Checklist

Before finishing documentation for a file, ask yourself:
1.  [ ] Can I fully understand how to use this class without reading the source code?
2.  [ ] Are all edge cases (nulls, empty lists, errors) mentioned?
3.  [ ] Is the tone professional and consistent?

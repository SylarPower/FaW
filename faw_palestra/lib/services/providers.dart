import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import 'auth_service.dart';
import 'exercise_service.dart';
import 'firebase_service.dart';

/// Provider per il servizio Firebase (singleton).
final firebaseServiceProvider = Provider<FirebaseService>((ref) {
  return FirebaseService.instance;
});

/// Provider per l'utente corrente (nome).
final currentUserProvider =
    StateNotifierProvider<CurrentUserNotifier, AsyncValue<String?>>((ref) {
  return CurrentUserNotifier();
});

class CurrentUserNotifier extends StateNotifier<AsyncValue<String?>> {
  CurrentUserNotifier() : super(const AsyncValue.loading()) {
    _load();
  }

  Future<void> _load() async {
    final nome = await AuthService.instance.currentNome();
    state = AsyncValue.data(nome);
  }

  Future<void> setNome(String nome) async {
    await AuthService.instance.setNome(nome);
    state = AsyncValue.data(nome);
  }

  Future<void> logout() async {
    await AuthService.instance.logout();
    state = const AsyncValue.data(null);
  }
}

/// Stream del profilo GymUser dal Firestore.
final gymUserProvider = StreamProvider.family<GymUser?, String>((ref, nome) {
  return ref.watch(firebaseServiceProvider).watchUser(nome);
});

/// Provider per la libreria esercizi (cached, async).
final allExercisesProvider = FutureProvider<List<Esercizio>>((ref) async {
  return ExerciseService.instance.all();
});

final macroGroupsProvider = FutureProvider<List<String>>((ref) async {
  final groups = await ExerciseService.instance.allMacroGroups();
  return ['Tutti', ...groups];
});

final exercisesByGroupProvider =
    FutureProvider.family<List<Esercizio>, String>((ref, group) async {
  return ExerciseService.instance.byMacroGroup(group);
});

final exerciseSearchProvider =
    FutureProvider.family<List<Esercizio>, String>((ref, query) async {
  return ExerciseService.instance.search(query);
});

/// Theme mode (dark/light/system).
final themeModeProvider =
    StateNotifierProvider<ThemeModeNotifier, ThemeMode>((ref) {
  return ThemeModeNotifier();
});

class ThemeModeNotifier extends StateNotifier<ThemeMode> {
  ThemeModeNotifier() : super(ThemeMode.system);

  void toggle() {
    state = state == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
  }

  void set(ThemeMode m) => state = m;
}

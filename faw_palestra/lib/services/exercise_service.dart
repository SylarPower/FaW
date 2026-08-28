import 'dart:convert';
import 'package:flutter/services.dart' show rootBundle;

import '../models/esercizio.dart';

/// Servizio per la libreria esercizi (~2539 entries).
///
/// Carica `assets/exercises.json` UNA volta, poi deduplica per id.
/// La deduplica serve perché lo stesso esercizio compare più volte
/// (una per ogni muscolo coinvolto).
class ExerciseService {
  ExerciseService._();
  static final ExerciseService instance = ExerciseService._();

  List<Esercizio>? _cache;
  List<Esercizio>? _dedup;

  Future<List<Esercizio>> all() async {
    if (_cache != null) return _cache!;
    final raw = await rootBundle.loadString('assets/exercises.json');
    final list = (json.decode(raw) as List)
        .map((e) => Esercizio.fromJson(e as Map<String, dynamic>))
        .toList();
    _cache = list;
    _dedup = _deduplicate(list);
    return _dedup!;
  }

  /// Dedup: tiene solo la prima occorrenza di ogni `id`.
  List<Esercizio> _deduplicate(List<Esercizio> input) {
    final seen = <String>{};
    final out = <Esercizio>[];
    for (final ex in input) {
      if (ex.id.isEmpty) continue;
      if (seen.add(ex.id)) out.add(ex);
    }
    return out;
  }

  Future<List<String>> allMacroGroups() async {
    final ex = await all();
    return ex.map((e) => e.macroGroup).toSet().toList()..sort();
  }

  Future<List<Esercizio>> byMacroGroup(String group) async {
    final ex = await all();
    if (group == 'Tutti') return ex;
    return ex.where((e) => e.macroGroup == group).toList();
  }

  Future<List<Esercizio>> search(String query) async {
    if (query.trim().isEmpty) return [];
    final ex = await all();
    final q = query.toLowerCase();
    return ex
        .where((e) =>
            e.name.toLowerCase().contains(q) ||
            e.muscle.toLowerCase().contains(q) ||
            e.eq.toLowerCase().contains(q))
        .take(50)
        .toList();
  }
}

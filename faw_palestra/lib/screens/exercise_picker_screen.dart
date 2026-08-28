import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';
import '../theme/app_theme.dart';

/// Picker esercizi: cerca e filtra dalla libreria.
class ExercisePickerScreen extends ConsumerStatefulWidget {
  const ExercisePickerScreen({super.key});

  @override
  ConsumerState<ExercisePickerScreen> createState() => _ExercisePickerScreenState();
}

class _ExercisePickerScreenState extends ConsumerState<ExercisePickerScreen> {
  String _selectedGroup = 'Tutti';
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final exercisesAsync = ref.watch(allExercisesProvider);
    final groupsAsync = ref.watch(macroGroupsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Scegli esercizio'),
      ),
      body: Column(
        children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              onChanged: (v) => setState(() => _query = v),
              decoration: const InputDecoration(
                hintText: 'Cerca esercizio, muscolo, attrezzo...',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),

          // Group filter
          groupsAsync.when(
            loading: () => const SizedBox(height: 48, child: Center(child: CircularProgressIndicator())),
            error: (e, _) => Text('Errore: $e'),
            data: (groups) => SizedBox(
              height: 44,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                itemCount: groups.length,
                separatorBuilder: (_, __) => const SizedBox(width: 6),
                itemBuilder: (ctx, i) {
                  final g = groups[i];
                  final selected = g == _selectedGroup;
                  return ChoiceChip(
                    label: Text(g),
                    selected: selected,
                    onSelected: (_) => setState(() => _selectedGroup = g),
                    selectedColor: AppTheme.accent,
                    backgroundColor: theme.colorScheme.surface,
                    labelStyle: TextStyle(
                      color: selected ? Colors.black : null,
                      fontWeight: FontWeight.w600,
                    ),
                  );
                },
              ),
            ),
          ),

          const Divider(height: 1),

          // List
          Expanded(
            child: exercisesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text('Errore: $e')),
              data: (all) {
                final filtered = _filter(all, _selectedGroup, _query);
                if (filtered.isEmpty) {
                  return const Center(
                    child: Text('Nessun esercizio trovato'),
                  );
                }
                return ListView.separated(
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (ctx, i) {
                    final ex = filtered[i];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: AppTheme.accent.withOpacity(0.15),
                        child: const Icon(Icons.fitness_center, color: AppTheme.accent, size: 18),
                      ),
                      title: Text(ex.name),
                      subtitle: Text('${ex.macroGroup} · ${ex.eq}'),
                      trailing: const Icon(Icons.add, color: AppTheme.accent),
                      onTap: () {
                        Navigator.of(context).pop(ex);
                      },
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  List<Esercizio> _filter(List<Esercizio> all, String group, String query) {
    Iterable<Esercizio> out = all;
    if (group != 'Tutti') {
      out = out.where((e) => e.macroGroup == group);
    }
    if (query.trim().isNotEmpty) {
      final q = query.toLowerCase();
      out = out.where((e) =>
          e.name.toLowerCase().contains(q) ||
          e.muscle.toLowerCase().contains(q) ||
          e.eq.toLowerCase().contains(q));
    }
    return out.take(100).toList();
  }
}

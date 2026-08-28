import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';
import '../services/session_provider.dart';
import '../services/workout_repository.dart';
import '../theme/app_theme.dart';
import 'exercise_detail_screen.dart';
import 'workout_form_screen.dart';
import 'workout_session_screen.dart';

/// Dettaglio di un workout day: lista esercizi con target, timer per serie, ecc.
class WorkoutDayDetailScreen extends ConsumerWidget {
  final WorkoutDay day;
  const WorkoutDayDetailScreen({super.key, required this.day});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    // Ricarica il day aggiornato (potrebbe essere stato modificato)
    final userAsync = ref.watch(gymUserProvider(
        ref.watch(currentUserProvider).value ?? ''));
    final currentDay = userAsync.maybeWhen(
      data: (u) => u?.days.firstWhere(
            (d) => d.id == day.id,
            orElse: () => day,
          ),
      orElse: () => day,
    );

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Text(currentDay.icon, style: const TextStyle(fontSize: 22)),
            const SizedBox(width: 8),
            Text(currentDay.name),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Modifica',
            onPressed: () => _editDay(context, currentDay),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Elimina',
            onPressed: () => _deleteDay(context, ref, currentDay),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // Quick info
          _DayInfo(day: currentDay),
          const SizedBox(height: 12),

          if (currentDay.exercises.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.add_circle_outline,
                        size: 48, color: AppTheme.accent),
                    const SizedBox(height: 12),
                    Text('Nessun esercizio',
                        style: theme.textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(
                      'Aggiungi esercizi per iniziare',
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        OutlinedButton.icon(
                          icon: const Icon(Icons.edit),
                          label: const Text('Modifica'),
                          onPressed: () => _editDay(context, currentDay),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton.icon(
                          icon: const Icon(Icons.content_copy),
                          label: const Text('Duplica'),
                          onPressed: () => _duplicateDay(context, ref, currentDay),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            )
          else ...[
            Text(
              'ESERCIZI',
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.6),
                letterSpacing: 1.2,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            ...currentDay.exercises.asMap().entries.map(
                (entry) => _ExerciseTile(index: entry.key, ex: entry.value)),
          ],
          const SizedBox(height: 80), // FAB space
        ],
      ),
      floatingActionButton: currentDay.exercises.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _startWorkout(context, ref, currentDay),
              icon: const Icon(Icons.play_arrow),
              label: const Text('Inizia'),
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.black,
            ),
    );
  }

  Future<void> _startWorkout(
      BuildContext context, WidgetRef ref, WorkoutDay day) async {
    ref.read(activeSessionProvider.notifier).start(day);
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const WorkoutSessionScreen()),
    );
  }

  Future<void> _editDay(BuildContext context, WorkoutDay day) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => WorkoutFormScreen(day: day),
      ),
    );
    if (changed == true && context.mounted) {
      // Torna alla home e ricarica (o lascia che lo stream di Firestore aggiorni)
      Navigator.of(context).pop();
    }
  }

  Future<void> _deleteDay(
      BuildContext context, WidgetRef ref, WorkoutDay day) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Eliminare "${day.name}"?'),
        content: const Text(
          'Questa azione è irreversibile. Tutti i dati di questo workout day verranno persi.\n\nLo storico degli allenamenti passati rimarrà intatto.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Annulla'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppTheme.danger),
            child: const Text('Elimina'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final nome = ref.read(currentUserProvider).valueOrNull;
    if (nome == null) return;
    await ref.read(workoutRepositoryProvider).deleteDay(nome, day.id);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('🗑️ Workout eliminato')),
    );
  }

  Future<void> _duplicateDay(
      BuildContext context, WidgetRef ref, WorkoutDay day) async {
    final nome = ref.read(currentUserProvider).valueOrNull;
    if (nome == null) return;
    final copy = await ref
        .read(workoutRepositoryProvider)
        .duplicateDay(nome, day.id);
    if (!context.mounted) return;
    if (copy != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✅ "${copy.name}" duplicato'),
          action: SnackBarAction(
            label: 'Vedi',
            onPressed: () {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (_) => WorkoutDayDetailScreen(day: copy),
                ),
              );
            },
          ),
        ),
      );
    }
  }
}

class _DayInfo extends StatelessWidget {
  final WorkoutDay day;
  const _DayInfo({required this.day});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            _Stat(label: 'Esercizi', value: '${day.totalExercises}'),
            const _Divider(),
            _Stat(
              label: 'Serie',
              value: '${day.exercises.fold(0, (a, e) => a + e.targetSets)}',
            ),
            const _Divider(),
            _Stat(
              label: 'Reps tot',
              value: '${day.exercises.fold(0, (a, e) => a + e.targetSets * e.targetReps)}',
            ),
            const _Divider(),
            _Stat(
              label: 'Gruppi',
              value: '${day.exercises.map((e) => e.muscleGroup).toSet().length}',
            ),
          ],
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 32,
      color: Theme.of(context).dividerColor,
      margin: const EdgeInsets.symmetric(horizontal: 12),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Text(value,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
              color: AppTheme.accent,
            )),
        Text(label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurface.withOpacity(0.6),
            )),
      ],
    );
  }
}

class _ExerciseTile extends StatelessWidget {
  final int index;
  final WorkoutExercise ex;
  const _ExerciseTile({required this.index, required this.ex});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            // Apri dettaglio esercizio (video) se ha un mediaUrl risolvibile
            // Per ora passiamo uno stub; in futuro si può fare lookup
            // dall'esercizio completo nella libreria.
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => ExerciseDetailScreen(
                  esercizio: Esercizio(
                    id: ex.exerciseId,
                    name: ex.exerciseName,
                    muscle: ex.muscleGroup,
                    eq: '',
                    media: const [],
                  ),
                ),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${index + 1}',
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        ex.exerciseName,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        ex.muscleGroup,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _Metric(
                      icon: Icons.format_list_numbered,
                      label: '${ex.targetSets} sets',
                    ),
                    const SizedBox(width: 12),
                    _Metric(
                      icon: Icons.repeat,
                      label: '${ex.targetReps} reps',
                    ),
                    const SizedBox(width: 12),
                    _Metric(
                      icon: Icons.fitness_center,
                      label: '${ex.targetWeight}kg',
                    ),
                    if (ex.series.isNotEmpty) ...[
                      const SizedBox(width: 12),
                      _Metric(
                        icon: Icons.history,
                        label: 'Ultimo: ${_lastDone(ex)}',
                      ),
                    ],
                  ],
                ),
                if (ex.series.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  // Mini progress bar
                  LinearProgressIndicator(
                    value: ex.targetSets == 0 ? 0 : ex.completedSets / ex.targetSets,
                    minHeight: 3,
                    backgroundColor: theme.colorScheme.surface,
                    valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _lastDone(WorkoutExercise ex) {
    final last = ex.series.lastWhere((s) => s.done, orElse: () => const Serie());
    if (last.reps == 0 && last.weight == 0) return 'mai';
    return '${last.reps}×${last.weight}kg';
  }
}

class _Metric extends StatelessWidget {
  final IconData icon;
  final String label;
  const _Metric({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: theme.colorScheme.onSurface.withOpacity(0.5)),
        const SizedBox(width: 3),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.7),
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';
import '../services/session_provider.dart';
import '../services/workout_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/stat_chip.dart';
import 'workout_day_detail.dart';
import 'workout_form_screen.dart';
import 'workout_session_screen.dart';

/// Home: lista workout days + statistiche rapide.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userAsync = ref.watch(gymUserProvider(
        ref.watch(currentUserProvider).value ?? ''));
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('GymTracker'),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart),
            tooltip: 'Statistiche',
            onPressed: () {
              // TODO: naviga a stats
            },
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Impostazioni',
            onPressed: () {
              // TODO: settings
            },
          ),
        ],
      ),
      body: userAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('Errore: $e')),
        data: (user) {
          if (user == null) {
            return Center(
              child: Text(
                'Nessun profilo trovato.\nCrea il tuo primo workout!',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
            );
          }

          return ListView(
            padding: const EdgeInsets.all(12),
            children: [
              // Stat cards
              _StatsRow(user: user),
              const SizedBox(height: 16),

              // Lista workout days
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'I tuoi workout',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  TextButton.icon(
                    icon: const Icon(Icons.add, size: 20),
                    label: const Text('Nuovo'),
                    onPressed: () async {
                      final created = await Navigator.of(context).push<bool>(
                        MaterialPageRoute(
                          builder: (_) => const WorkoutFormScreen(),
                        ),
                      );
                      if (created == true && context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('✅ Workout creato!'),
                            backgroundColor: AppTheme.success,
                          ),
                        );
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 8),

              if (user.days.isEmpty)
                _EmptyState(
                  onCreate: () async {
                    final created = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) => const WorkoutFormScreen(),
                      ),
                    );
                    if (created == true && context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('✅ Workout creato!'),
                          backgroundColor: AppTheme.success,
                        ),
                      );
                    }
                  },
                )
              else
                ...user.days.map((day) => _DayCard(day: day)),
            ],
          );
        },
      ),
      floatingActionButton: user.days.isEmpty
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _showStartWorkoutSheet(context, ref, user),
              icon: const Icon(Icons.play_arrow),
              label: const Text('Inizia workout'),
              backgroundColor: AppTheme.accent,
              foregroundColor: Colors.black,
            ),
    );
  }
}

class _StatsRow extends StatelessWidget {
  final GymUser user;
  const _StatsRow({required this.user});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: StatChip(
            icon: Icons.local_fire_department,
            label: 'Sets/sett',
            value: '${user.weeklySets}',
            color: AppTheme.danger,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: StatChip(
            icon: Icons.fitness_center,
            label: 'Volume/sett',
            value: '${(user.weeklyVolume / 1000).toStringAsFixed(1)}t',
            color: AppTheme.accent,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: StatChip(
            icon: Icons.history,
            label: 'Workout',
            value: '${user.hist.length}',
            color: AppTheme.purple,
          ),
        ),
      ],
    );
  }
}

class _DayCard extends ConsumerWidget {
  final WorkoutDay day;
  const _DayCard({required this.day});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Dismissible(
        key: ValueKey('day-${day.id}'),
        direction: DismissDirection.endToStart,
        confirmDismiss: (_) => _confirmDelete(context, ref),
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.symmetric(horizontal: 24),
          decoration: BoxDecoration(
            color: AppTheme.danger,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              Icon(Icons.delete_outline, color: Colors.white),
              SizedBox(width: 8),
              Text('Elimina', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        child: Card(
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => WorkoutDayDetailScreen(day: day),
                ),
              );
            },
            onLongPress: () => _showQuickActions(context, ref),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      day.icon,
                      style: const TextStyle(fontSize: 28),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          day.name,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${day.totalExercises} esercizi',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.6),
                          ),
                        ),
                        if (day.lastPerformed != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Ultimo: ${_ago(day.lastPerformed!)}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: AppTheme.accent,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Icon(
                    Icons.chevron_right,
                    color: theme.colorScheme.onSurface.withOpacity(0.4),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<bool> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final res = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Eliminare "${day.name}"?'),
        content: const Text('Trascina per confermare.'),
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
    if (res == true) {
      final nome = ref.read(currentUserProvider).valueOrNull;
      if (nome != null) {
        await ref.read(workoutRepositoryProvider).deleteDay(nome, day.id);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('🗑️ Workout eliminato')),
          );
        }
      }
    }
    return res ?? false;
  }

  void _showQuickActions(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 8),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(ctx).dividerColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Modifica'),
                onTap: () {
                  Navigator.pop(ctx);
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => WorkoutFormScreen(day: day),
                    ),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.content_copy),
                title: const Text('Duplica'),
                onTap: () async {
                  Navigator.pop(ctx);
                  final nome = ref.read(currentUserProvider).valueOrNull;
                  if (nome == null) return;
                  final copy = await ref
                      .read(workoutRepositoryProvider)
                      .duplicateDay(nome, day.id);
                  if (context.mounted && copy != null) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('✅ "${copy.name}" duplicato')),
                    );
                  }
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppTheme.danger),
                title: const Text('Elimina', style: TextStyle(color: AppTheme.danger)),
                onTap: () async {
                  Navigator.pop(ctx);
                  final res = await showDialog<bool>(
                    context: context,
                    builder: (dctx) => AlertDialog(
                      title: Text('Eliminare "${day.name}"?'),
                      content: const Text('Questa azione è irreversibile.'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(dctx, false),
                          child: const Text('Annulla'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(dctx, true),
                          style: TextButton.styleFrom(
                              foregroundColor: AppTheme.danger),
                          child: const Text('Elimina'),
                        ),
                      ],
                    ),
                  );
                  if (res == true) {
                    final nome = ref.read(currentUserProvider).valueOrNull;
                    if (nome != null) {
                      await ref
                          .read(workoutRepositoryProvider)
                          .deleteDay(nome, day.id);
                    }
                  }
                },
              ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  String _ago(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inDays > 0) return '${diff.inDays}g fa';
    if (diff.inHours > 0) return '${diff.inHours}h fa';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m fa';
    return 'ora';
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onCreate;
  const _EmptyState({required this.onCreate});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          children: [
            Icon(
              Icons.fitness_center,
              size: 56,
              color: AppTheme.accent.withOpacity(0.5),
            ),
            const SizedBox(height: 12),
            Text(
              'Nessun workout ancora',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Crea il tuo primo giorno di allenamento',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              icon: const Icon(Icons.add),
              label: const Text('Crea workout'),
              onPressed: onCreate,
            ),
          ],
        ),
      ),
    );
  }
}

void _showStartWorkoutSheet(
    BuildContext context, WidgetRef ref, GymUser user) {
  showModalBottomSheet(
    context: context,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Theme.of(ctx).dividerColor,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Scegli workout',
                style: Theme.of(ctx).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              ...user.days.map((day) {
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(day.icon, style: const TextStyle(fontSize: 24)),
                  ),
                  title: Text(day.name,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${day.totalExercises} esercizi'),
                  trailing: const Icon(Icons.play_arrow, color: AppTheme.accent),
                  onTap: () {
                    ref.read(activeSessionProvider.notifier).start(day);
                    Navigator.pop(ctx);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const WorkoutSessionScreen(),
                      ),
                    );
                  },
                );
              }),
            ],
          ),
        ),
      );
    },
  );
}

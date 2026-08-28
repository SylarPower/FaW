import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/models.dart';
import '../services/providers.dart';
import '../services/session_provider.dart';
import '../theme/app_theme.dart';
import 'exercise_detail_screen.dart';

/// Schermata "active workout": l'utente è in palestra, tappa le serie fatte.
class WorkoutSessionScreen extends ConsumerStatefulWidget {
  const WorkoutSessionScreen({super.key});

  @override
  ConsumerState<WorkoutSessionScreen> createState() => _WorkoutSessionScreenState();
}

class _WorkoutSessionScreenState extends ConsumerState<WorkoutSessionScreen> {
  Timer? _ticker;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    // Tick ogni secondo per aggiornare timer e UI
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      final s = ref.read(activeSessionProvider).valueOrNull;
      if (s != null && mounted) {
        setState(() => _elapsed = s.elapsed);
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<bool> _confirmExit() async {
    final s = ref.read(activeSessionProvider).valueOrNull;
    if (s == null || s.completedSets == 0) return true;

    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Uscire dal workout?'),
        content: Text(
          'Hai completato ${s.completedSets} serie. Vuoi salvare prima di uscire?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Annulla'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Esci senza salvare'),
          ),
          ElevatedButton(
            onPressed: () async {
              final nome = ref.read(currentUserProvider).valueOrNull;
              if (nome != null) {
                await ref.read(activeSessionProvider.notifier).finish(nome);
              }
              if (mounted) Navigator.pop(ctx, true);
            },
            child: const Text('Salva ed esci'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final sessionAsync = ref.watch(activeSessionProvider);

    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) async {
        if (didPop) return;
        if (await _confirmExit()) {
          ref.read(activeSessionProvider.notifier).cancel();
          if (mounted) Navigator.of(context).pop();
        }
      },
      child: sessionAsync.when(
        loading: () => const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => Scaffold(body: Center(child: Text('Errore: $e'))),
        data: (session) {
          if (session == null) {
            // Nessuna sessione attiva: tornato indietro
            return const Scaffold(body: SizedBox.shrink());
          }
          return _buildSessionUI(session);
        },
      ),
    );
  }

  Widget _buildSessionUI(ActiveSession session) {
    final theme = Theme.of(context);
    final isLast = session.currentExerciseIdx >= session.exercises.length - 1;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () async {
            if (await _confirmExit()) {
              ref.read(activeSessionProvider.notifier).cancel();
              if (mounted) Navigator.of(context).pop();
            }
          },
        ),
        title: Text(
          '${session.day.icon} ${session.day.name}',
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Center(
              child: Row(
                children: [
                  const Icon(Icons.timer_outlined, size: 16, color: AppTheme.accent),
                  const SizedBox(width: 4),
                  Text(
                    _formatDuration(_elapsed),
                    style: const TextStyle(
                      color: AppTheme.accent,
                      fontWeight: FontWeight.bold,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Progress header
          _SessionProgress(session: session),

          // Exercise list (compact)
          _ExerciseList(session: session),

          // Current exercise detail
          Expanded(
            child: _CurrentExercisePanel(session: session, isLast: isLast),
          ),
        ],
      ),
    );
  }

  String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    final s = d.inSeconds.remainder(60);
    if (h > 0) {
      return '${h}h ${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
}

class _SessionProgress extends StatelessWidget {
  final ActiveSession session;
  const _SessionProgress({required this.session});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final progress = session.exercises.isEmpty
        ? 0.0
        : (session.currentExerciseIdx + 1) / session.exercises.length;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Esercizio ${session.currentExerciseIdx + 1}/${session.exercises.length}',
                style: theme.textTheme.labelMedium,
              ),
              Text(
                '${session.completedSets} serie fatte',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: AppTheme.accent,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              backgroundColor: theme.colorScheme.surface,
              valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
            ),
          ),
        ],
      ),
    );
  }
}

class _ExerciseList extends StatelessWidget {
  final ActiveSession session;
  const _ExerciseList({required this.session});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        itemCount: session.exercises.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (ctx, i) {
          final ex = session.exercises[i];
          final isCurrent = i == session.currentExerciseIdx;
          final isDone = ex.isComplete;
          return GestureDetector(
            onTap: () {
              // Salta all'esercizio (il provider ha solo next/prev,
              // ma con copyWith possiamo settare direttamente)
              // Per semplicità: usiamo next/prev
            },
            child: Container(
              width: 120,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: isCurrent
                    ? AppTheme.accent.withOpacity(0.15)
                    : Theme.of(context).colorScheme.surface,
                border: Border.all(
                  color: isCurrent
                      ? AppTheme.accent
                      : (isDone ? AppTheme.success : Theme.of(context).dividerColor),
                  width: isCurrent ? 2 : 1,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (isDone)
                        const Icon(Icons.check_circle, size: 12, color: AppTheme.success),
                      if (isCurrent && !isDone)
                        const Icon(Icons.play_arrow, size: 12, color: AppTheme.accent),
                      const SizedBox(width: 4),
                      Text(
                        '${i + 1}',
                        style: TextStyle(
                          fontSize: 10,
                          color: isCurrent ? AppTheme.accent : null,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  Text(
                    ex.exerciseName,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${ex.completedSets}/${ex.targetSets} sets',
                    style: TextStyle(
                      fontSize: 10,
                      color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _CurrentExercisePanel extends ConsumerStatefulWidget {
  final ActiveSession session;
  final bool isLast;
  const _CurrentExercisePanel({required this.session, required this.isLast});

  @override
  ConsumerState<_CurrentExercisePanel> createState() => _CurrentExercisePanelState();
}

class _CurrentExercisePanelState extends ConsumerState<_CurrentExercisePanel> {
  int? _restTimerStartedMs;
  Timer? _restTicker;
  int _restSecondsLeft = 0;

  static const _defaultRestSec = 90; // 1:30 recupero di default

  @override
  void dispose() {
    _restTicker?.cancel();
    super.dispose();
  }

  void _startRest({int seconds = _defaultRestSec}) {
    setState(() {
      _restTimerStartedMs = DateTime.now().millisecondsSinceEpoch;
      _restSecondsLeft = seconds;
    });
    _restTicker?.cancel();
    _restTicker = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      setState(() {
        _restSecondsLeft--;
        if (_restSecondsLeft <= 0) {
          t.cancel();
          HapticFeedback.heavyImpact();
        }
      });
    });
  }

  void _stopRest() {
    _restTicker?.cancel();
    setState(() {
      _restTimerStartedMs = null;
      _restSecondsLeft = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final ex = widget.session.currentExercise;
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Exercise name + open detail
        Row(
          children: [
            Expanded(
              child: Text(
                ex.exerciseName,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            IconButton.filledTonal(
              icon: const Icon(Icons.play_circle_outline, size: 28),
              onPressed: () {
                // Crea un Esercizio stub per il video (abbiamo solo i dati limitati qui)
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ExerciseDetailScreen(
                      esercizio: Esercizio(
                        id: ex.exerciseId,
                        name: ex.exerciseName,
                        muscle: ex.muscleGroup,
                        eq: '',
                        media: const [], // caricato lato picker
                      ),
                    ),
                  ),
                );
              },
            ),
          ],
        ),
        Text(
          'Target: ${ex.targetSets}×${ex.targetReps} @ ${ex.targetWeight}kg',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.6),
          ),
        ),
        const SizedBox(height: 16),

        // Rest timer
        if (_restTimerStartedMs != null)
          _RestTimerCard(
            secondsLeft: _restSecondsLeft,
            total: _defaultRestSec,
            onStop: _stopRest,
            onAddTime: (s) => setState(() => _restSecondsLeft += s),
          )
        else
          OutlinedButton.icon(
            onPressed: () => _startRest(),
            icon: const Icon(Icons.timer_outlined),
            label: const Text('Avvia recupero (1:30)'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppTheme.accent,
              side: const BorderSide(color: AppTheme.accent),
              minimumSize: const Size(double.infinity, 48),
            ),
          ),
        const SizedBox(height: 16),

        // Series list
        Text(
          'SERIE',
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.6),
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(height: 8),
        ...ex.series.asMap().entries.map((entry) {
          final i = entry.key;
          final s = entry.value;
          return _SetRow(
            setIndex: i,
            set: s,
            onChanged: (reps, weight) {
              ref.read(activeSessionProvider.notifier)
                  .updateSet(widget.session.currentExerciseIdx, i,
                      reps: reps, weight: weight);
            },
            onDone: (reps, weight) {
              ref.read(activeSessionProvider.notifier)
                  .markSetDone(widget.session.currentExerciseIdx, i,
                      reps: reps, weight: weight, restSec: _defaultRestSec);
              HapticFeedback.lightImpact();
              _startRest();
              setState(() {});
            },
            onDelete: () {
              ref.read(activeSessionProvider.notifier)
                  .removeSet(widget.session.currentExerciseIdx, i);
            },
          );
        }),

        const SizedBox(height: 8),
        // Add set
        TextButton.icon(
          onPressed: () {
            ref.read(activeSessionProvider.notifier)
                .addSet(widget.session.currentExerciseIdx);
          },
          icon: const Icon(Icons.add),
          label: const Text('Aggiungi serie'),
        ),

        const SizedBox(height: 16),
        // Navigation
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: widget.session.currentExerciseIdx == 0
                    ? null
                    : () => ref.read(activeSessionProvider.notifier).prevExercise(),
                icon: const Icon(Icons.chevron_left),
                label: const Text('Precedente'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 52),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 2,
              child: ElevatedButton.icon(
                onPressed: () async {
                  if (widget.isLast) {
                    // Finish workout
                    final nome = ref.read(currentUserProvider).valueOrNull;
                    if (nome != null) {
                      await ref.read(activeSessionProvider.notifier).finish(nome);
                    }
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('💪 Workout completato! Salvato.'),
                          backgroundColor: AppTheme.success,
                        ),
                      );
                      Navigator.of(context).pop();
                    }
                  } else {
                    ref.read(activeSessionProvider.notifier).nextExercise();
                    _stopRest();
                  }
                },
                icon: Icon(widget.isLast ? Icons.check : Icons.chevron_right),
                label: Text(widget.isLast ? 'FINISCI' : 'PROSSIMO'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(0, 52),
                  backgroundColor: widget.isLast ? AppTheme.success : AppTheme.accent,
                  foregroundColor: widget.isLast ? Colors.white : Colors.black,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SetRow extends StatefulWidget {
  final int setIndex;
  final Serie set;
  final void Function(int reps, double weight) onChanged;
  final void Function(int reps, double weight) onDone;
  final VoidCallback onDelete;

  const _SetRow({
    required this.setIndex,
    required this.set,
    required this.onChanged,
    required this.onDone,
    required this.onDelete,
  });

  @override
  State<_SetRow> createState() => _SetRowState();
}

class _SetRowState extends State<_SetRow> {
  late TextEditingController _repsCtrl;
  late TextEditingController _weightCtrl;

  @override
  void initState() {
    super.initState();
    _repsCtrl = TextEditingController(text: widget.set.reps.toString());
    _weightCtrl = TextEditingController(text: widget.set.weight.toString());
  }

  @override
  void didUpdateWidget(covariant _SetRow old) {
    super.didUpdateWidget(old);
    if (widget.set.reps.toString() != _repsCtrl.text) {
      _repsCtrl.text = widget.set.reps.toString();
    }
    if (widget.set.weight.toString() != _weightCtrl.text) {
      _weightCtrl.text = widget.set.weight.toString();
    }
  }

  @override
  void dispose() {
    _repsCtrl.dispose();
    _weightCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final done = widget.set.done;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        decoration: BoxDecoration(
          color: done ? AppTheme.success.withOpacity(0.08) : theme.colorScheme.surface,
          border: Border.all(
            color: done ? AppTheme.success : theme.dividerColor,
            width: done ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          children: [
            // Set number
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: done ? AppTheme.success : AppTheme.accent.withOpacity(0.15),
                shape: BoxShape.circle,
              ),
              child: done
                  ? const Icon(Icons.check, color: Colors.white, size: 20)
                  : Text(
                      '${widget.setIndex + 1}',
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
            ),
            const SizedBox(width: 8),

            // Reps
            Expanded(
              child: _NumberField(
                controller: _repsCtrl,
                label: 'reps',
                enabled: !done,
                onChanged: (v) {
                  final reps = int.tryParse(v) ?? 0;
                  widget.onChanged(reps, double.tryParse(_weightCtrl.text) ?? 0);
                },
              ),
            ),
            const SizedBox(width: 6),
            Text('×', style: theme.textTheme.titleMedium),
            const SizedBox(width: 6),

            // Weight
            Expanded(
              child: _NumberField(
                controller: _weightCtrl,
                label: 'kg',
                enabled: !done,
                onChanged: (v) {
                  final w = double.tryParse(v) ?? 0;
                  widget.onChanged(int.tryParse(_repsCtrl.text) ?? 0, w);
                },
              ),
            ),
            const SizedBox(width: 4),

            // Done button
            IconButton(
              onPressed: done
                  ? null
                  : () {
                      final reps = int.tryParse(_repsCtrl.text) ?? 0;
                      final weight = double.tryParse(_weightCtrl.text) ?? 0;
                      widget.onDone(reps, weight);
                    },
              icon: Icon(
                done ? Icons.check_circle : Icons.radio_button_unchecked,
                color: done ? AppTheme.success : AppTheme.accent,
                size: 32,
              ),
            ),
            // Delete
            if (!done)
              IconButton(
                onPressed: widget.onDelete,
                icon: Icon(Icons.delete_outline, color: theme.colorScheme.onSurface.withOpacity(0.4), size: 20),
              ),
          ],
        ),
      ),
    );
  }
}

class _NumberField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool enabled;
  final ValueChanged<String> onChanged;
  const _NumberField({
    required this.controller,
    required this.label,
    required this.enabled,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textAlign: TextAlign.center,
      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
      decoration: InputDecoration(
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        suffixText: label,
        suffixStyle: const TextStyle(fontSize: 11),
      ),
      onChanged: onChanged,
    );
  }
}

class _RestTimerCard extends StatelessWidget {
  final int secondsLeft;
  final int total;
  final VoidCallback onStop;
  final ValueChanged<int> onAddTime;
  const _RestTimerCard({
    required this.secondsLeft,
    required this.total,
    required this.onStop,
    required this.onAddTime,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final done = secondsLeft <= 0;
    final mm = (secondsLeft ~/ 60).abs().toString().padLeft(2, '0');
    final ss = (secondsLeft % 60).abs().toString().padLeft(2, '0');
    final progress = done ? 1.0 : 1 - (secondsLeft / total).clamp(0.0, 1.0);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: done ? AppTheme.success.withOpacity(0.15) : AppTheme.accent.withOpacity(0.1),
        border: Border.all(
          color: done ? AppTheme.success : AppTheme.accent,
          width: 2,
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Icon(
                done ? Icons.notifications_active : Icons.timer,
                color: done ? AppTheme.success : AppTheme.accent,
              ),
              const SizedBox(width: 8),
              Text(
                done ? 'RECUPERO FINITO!' : 'RECUPERO',
                style: theme.textTheme.labelMedium?.copyWith(
                  color: done ? AppTheme.success : AppTheme.accent,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
              ),
              const Spacer(),
              if (!done)
                TextButton(
                  onPressed: onStop,
                  child: const Text('Salta'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            done ? '00:00' : '$mm:$ss',
            style: TextStyle(
              fontSize: 48,
              fontWeight: FontWeight.w900,
              color: done ? AppTheme.success : AppTheme.accent,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (!done) ...[
            const SizedBox(height: 4),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progress,
                minHeight: 4,
                backgroundColor: theme.colorScheme.surface,
                valueColor: const AlwaysStoppedAnimation(AppTheme.accent),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton.icon(
                  onPressed: () => onAddTime(15),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('+15s'),
                ),
                TextButton.icon(
                  onPressed: () => onAddTime(-15),
                  icon: const Icon(Icons.remove, size: 16),
                  label: const Text('-15s'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

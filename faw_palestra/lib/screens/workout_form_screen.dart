import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/workout_templates.dart';
import '../models/models.dart';
import '../services/providers.dart';
import '../services/workout_editor_provider.dart';
import '../services/workout_repository.dart';
import '../theme/app_theme.dart';
import 'exercise_picker_screen.dart';
import 'workout_day_detail.dart';

/// Schermata per creare o modificare un workout day.
class WorkoutFormScreen extends ConsumerStatefulWidget {
  final WorkoutDay? day; // null = creazione
  const WorkoutFormScreen({super.key, this.day});

  @override
  ConsumerState<WorkoutFormScreen> createState() => _WorkoutFormScreenState();
}

class _WorkoutFormScreenState extends ConsumerState<WorkoutFormScreen> {
  late final TextEditingController _nameCtrl;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  void _initEditor() {
    if (_initialized) return;
    _initialized = true;
    if (widget.day != null) {
      ref.read(workoutEditorProvider.notifier).initFrom(widget.day!);
    } else {
      ref.read(workoutEditorProvider.notifier).initNew();
    }
    _nameCtrl.text = ref.read(workoutEditorProvider).name;
  }

  @override
  Widget build(BuildContext context) {
    _initEditor();
    final state = ref.watch(workoutEditorProvider);
    final theme = Theme.of(context);

    return PopScope(
      canPop: !state.dirty,
      onPopInvoked: (didPop) async {
        if (didPop) return;
        final shouldPop = await _showDiscardDialog();
        if (shouldPop && mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.day == null ? 'Nuovo workout' : 'Modifica workout'),
          actions: [
            if (state.saving)
              const Padding(
                padding: EdgeInsets.all(16),
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              )
            else
              TextButton(
                onPressed: state.isValid ? _save : null,
                child: Text(
                  'Salva',
                  style: TextStyle(
                    color: state.isValid ? AppTheme.accent : Colors.grey,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ===== NOME =====
            Text('NOME', style: _labelStyle(theme)),
            const SizedBox(height: 6),
            TextField(
              controller: _nameCtrl,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                hintText: 'es. Push Day, Leg Day...',
                prefixIcon: Icon(Icons.label_outline),
              ),
              onChanged: (v) =>
                  ref.read(workoutEditorProvider.notifier).setName(v),
            ),

            const SizedBox(height: 20),

            // ===== ICONA =====
            Text('ICONA', style: _labelStyle(theme)),
            const SizedBox(height: 6),
            _IconPicker(
              selected: state.icon,
              onSelected: (i) =>
                  ref.read(workoutEditorProvider.notifier).setIcon(i),
            ),

            const SizedBox(height: 20),

            // ===== TEMPLATE (solo in creazione) =====
            if (widget.day == null) ...[
              Text('PARTI DA UN TEMPLATE', style: _labelStyle(theme)),
              const SizedBox(height: 6),
              Text(
                'Velocizza la creazione scegliendo un template predefinito. Potrai personalizzarlo dopo.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withOpacity(0.6),
                ),
              ),
              const SizedBox(height: 12),
              _TemplatePicker(
                onPick: (tpl) => _applyTemplate(tpl),
              ),
              const SizedBox(height: 20),
            ],

            // ===== ESERCIZI =====
            Row(
              children: [
                Text(
                  'ESERCIZI (${state.exercises.length})',
                  style: _labelStyle(theme),
                ),
                const Spacer(),
                if (state.exercises.isNotEmpty)
                  TextButton.icon(
                    onPressed: _reorderModeToggle,
                    icon: Icon(_reorderMode ? Icons.check : Icons.swap_vert),
                    label: Text(_reorderMode ? 'Fine' : 'Riordina'),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            if (state.exercises.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Icon(
                        Icons.add_circle_outline,
                        size: 40,
                        color: AppTheme.accent.withOpacity(0.5),
                      ),
                      const SizedBox(height: 8),
                      const Text('Nessun esercizio ancora'),
                      const SizedBox(height: 12),
                      ElevatedButton.icon(
                        icon: const Icon(Icons.search),
                        label: const Text('Aggiungi esercizio'),
                        onPressed: _pickExercise,
                      ),
                    ],
                  ),
                ),
              )
            else
              ReorderableListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                buildDefaultDragHandles: _reorderMode,
                itemCount: state.exercises.length,
                onReorder: (oldIdx, newIdx) {
                  ref
                      .read(workoutEditorProvider.notifier)
                      .reorderExercises(oldIdx, newIdx);
                },
                itemBuilder: (ctx, i) {
                  final ex = state.exercises[i];
                  return _ExerciseEditorCard(
                    key: ValueKey('ex-${ex.exerciseId}-$i'),
                    index: i,
                    exercise: ex,
                    reorderMode: _reorderMode,
                    onUpdate: (sets, reps, weight) {
                      ref.read(workoutEditorProvider.notifier).updateExerciseTarget(
                            i,
                            targetSets: sets,
                            targetReps: reps,
                            targetWeight: weight,
                          );
                    },
                    onRemove: () =>
                        ref.read(workoutEditorProvider.notifier).removeExercise(i),
                  );
                },
              ),

            const SizedBox(height: 12),

            // Aggiungi esercizio
            if (!_reorderMode)
              OutlinedButton.icon(
                onPressed: _pickExercise,
                icon: const Icon(Icons.add),
                label: const Text('Aggiungi esercizio'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 52),
                  foregroundColor: AppTheme.accent,
                  side: const BorderSide(color: AppTheme.accent),
                ),
              ),

            // Error
            if (state.error != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.danger.withOpacity(0.1),
                  border: Border.all(color: AppTheme.danger),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.danger),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        state.error!,
                        style: const TextStyle(color: AppTheme.danger),
                      ),
                    ),
                  ],
                ),
              ),
            ],

            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  TextStyle _labelStyle(ThemeData theme) => theme.textTheme.labelSmall!.copyWith(
        color: theme.colorScheme.onSurface.withOpacity(0.6),
        letterSpacing: 1.2,
        fontWeight: FontWeight.bold,
      );

  bool _reorderMode = false;

  void _reorderModeToggle() {
    setState(() => _reorderMode = !_reorderMode);
    HapticFeedback.selectionClick();
  }

  Future<void> _pickExercise() async {
    final ex = await Navigator.of(context).push<Esercizio>(
      MaterialPageRoute(builder: (_) => const ExercisePickerScreen()),
    );
    if (ex != null) {
      ref.read(workoutEditorProvider.notifier).addExercise(ex);
    }
  }

  Future<void> _applyTemplate(WorkoutTemplate tpl) async {
    // Carica libreria esercizi (già in cache)
    final library = await ref.read(allExercisesProvider.future);
    final day = WorkoutTemplates.fromTemplate(tpl, library);
    // Reset editor con esercizi del template
    ref.read(workoutEditorProvider.notifier).initNew();
    ref.read(workoutEditorProvider.notifier).setName(tpl.name);
    ref.read(workoutEditorProvider.notifier).setIcon(tpl.icon);
    for (final ex in day.exercises) {
      // Aggiungi uno per uno (l'editor fa solo add)
      // Hack: creiamo un Esercizio stub
      final lib = library.firstWhere(
        (e) => e.id == ex.exerciseId,
        orElse: () => Esercizio(
          id: ex.exerciseId,
          name: ex.exerciseName,
          muscle: ex.muscleGroup,
          eq: '',
          media: const [],
        ),
      );
      ref.read(workoutEditorProvider.notifier).addExercise(lib);
      // Poi sovrascrivi l'ultimo aggiunto con i target del template
      final st = ref.read(workoutEditorProvider);
      final lastIdx = st.exercises.length - 1;
      ref.read(workoutEditorProvider.notifier).updateExerciseTarget(
            lastIdx,
            targetSets: ex.targetSets,
            targetReps: ex.targetReps,
            targetWeight: ex.targetWeight,
          );
    }
    HapticFeedback.mediumImpact();
  }

  Future<void> _save() async {
    final ok = await ref.read(workoutEditorProvider.notifier).save();
    if (!mounted) return;
    if (ok) {
      // Torna al dettaglio (o alla home se era creazione)
      if (widget.day != null) {
        // Aggiorna anche la schermata dettaglio sottostante
        Navigator.of(context).pop(true); // workout aggiornato
      } else {
        Navigator.of(context).pop(true); // nuovo creato
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Errore durante il salvataggio'),
          backgroundColor: AppTheme.danger,
        ),
      );
    }
  }

  Future<bool> _showDiscardDialog() async {
    final res = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Scartare le modifiche?'),
        content: const Text(
            'Hai delle modifiche non salvate. Se esci adesso verranno perse.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Annulla'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Scarta'),
          ),
        ],
      ),
    );
    return res ?? false;
  }
}

class _IconPicker extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelected;
  const _IconPicker({required this.selected, required this.onSelected});

  static const _icons = [
    '💪', '🔙', '🦵', '🏋️', '🏃', '🚴', '🔥', '⚡',
    '💎', '🎯', '⭐', '🌟', '✨', '🎪', '🏆', '🥇',
    '🥊', '🤸', '🤾', '⛹️', '🧗', '🏊', '🚣', '⛷️',
  ];

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _icons.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (ctx, i) {
          final icon = _icons[i];
          final isSel = icon == selected;
          return GestureDetector(
            onTap: () {
              onSelected(icon);
              HapticFeedback.selectionClick();
            },
            child: Container(
              width: 56,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSel
                    ? AppTheme.accent.withOpacity(0.2)
                    : Theme.of(context).colorScheme.surface,
                border: Border.all(
                  color: isSel ? AppTheme.accent : Theme.of(context).dividerColor,
                  width: isSel ? 2 : 1,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(icon, style: const TextStyle(fontSize: 28)),
            ),
          );
        },
      ),
    );
  }
}

class _TemplatePicker extends StatelessWidget {
  final ValueChanged<WorkoutTemplate> onPick;
  const _TemplatePicker({required this.onPick});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 110,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: WorkoutTemplates.all.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (ctx, i) {
          final tpl = WorkoutTemplates.all[i];
          return GestureDetector(
            onTap: () => onPick(tpl),
            child: Container(
              width: 140,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border.all(color: Theme.of(context).dividerColor),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(tpl.icon, style: const TextStyle(fontSize: 28)),
                  Text(
                    tpl.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${tpl.exercises.length} esercizi',
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withOpacity(0.6),
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

class _ExerciseEditorCard extends StatefulWidget {
  final int index;
  final WorkoutExercise exercise;
  final bool reorderMode;
  final void Function(int sets, int reps, double weight) onUpdate;
  final VoidCallback onRemove;

  const _ExerciseEditorCard({
    super.key,
    required this.index,
    required this.exercise,
    required this.reorderMode,
    required this.onUpdate,
    required this.onRemove,
  });

  @override
  State<_ExerciseEditorCard> createState() => _ExerciseEditorCardState();
}

class _ExerciseEditorCardState extends State<_ExerciseEditorCard> {
  late TextEditingController _setsCtrl;
  late TextEditingController _repsCtrl;
  late TextEditingController _weightCtrl;

  @override
  void initState() {
    super.initState();
    _setsCtrl = TextEditingController(text: widget.exercise.targetSets.toString());
    _repsCtrl = TextEditingController(text: widget.exercise.targetReps.toString());
    _weightCtrl =
        TextEditingController(text: widget.exercise.targetWeight.toString());
  }

  @override
  void didUpdateWidget(covariant _ExerciseEditorCard old) {
    super.didUpdateWidget(old);
    if (widget.exercise.targetSets.toString() != _setsCtrl.text) {
      _setsCtrl.text = widget.exercise.targetSets.toString();
    }
    if (widget.exercise.targetReps.toString() != _repsCtrl.text) {
      _repsCtrl.text = widget.exercise.targetReps.toString();
    }
    if (widget.exercise.targetWeight.toString() != _weightCtrl.text) {
      _weightCtrl.text = widget.exercise.targetWeight.toString();
    }
  }

  @override
  void dispose() {
    _setsCtrl.dispose();
    _repsCtrl.dispose();
    _weightCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
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
                      '${widget.index + 1}',
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontWeight: FontWeight.bold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.exercise.exerciseName,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          widget.exercise.muscleGroup,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.6),
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline,
                        color: AppTheme.danger, size: 20),
                    onPressed: widget.onRemove,
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _MiniField(
                      controller: _setsCtrl,
                      label: 'Sets',
                      onChanged: (v) => widget.onUpdate(
                        int.tryParse(v) ?? 3,
                        int.tryParse(_repsCtrl.text) ?? 10,
                        double.tryParse(_weightCtrl.text) ?? 0,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _MiniField(
                      controller: _repsCtrl,
                      label: 'Reps',
                      onChanged: (v) => widget.onUpdate(
                        int.tryParse(_setsCtrl.text) ?? 3,
                        int.tryParse(v) ?? 10,
                        double.tryParse(_weightCtrl.text) ?? 0,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _MiniField(
                      controller: _weightCtrl,
                      label: 'Kg',
                      onChanged: (v) => widget.onUpdate(
                        int.tryParse(_setsCtrl.text) ?? 3,
                        int.tryParse(_repsCtrl.text) ?? 10,
                        double.tryParse(v) ?? 0,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final ValueChanged<String> onChanged;
  const _MiniField({
    required this.controller,
    required this.label,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      textAlign: TextAlign.center,
      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
      decoration: InputDecoration(
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
        labelText: label,
        labelStyle: const TextStyle(fontSize: 11),
      ),
      onChanged: onChanged,
    );
  }
}

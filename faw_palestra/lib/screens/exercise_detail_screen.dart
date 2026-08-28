import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';
import 'package:chewie/chewie.dart';

import '../models/models.dart';
import '../theme/app_theme.dart';

/// Dettaglio esercizio: video dimostrativo + descrizione.
class ExerciseDetailScreen extends ConsumerStatefulWidget {
  final Esercizio esercizio;
  const ExerciseDetailScreen({super.key, required this.esercizio});

  @override
  ConsumerState<ExerciseDetailScreen> createState() => _ExerciseDetailScreenState();
}

class _ExerciseDetailScreenState extends ConsumerState<ExerciseDetailScreen> {
  VideoPlayerController? _videoCtrl;
  ChewieController? _chewieCtrl;
  String? _err;

  @override
  void initState() {
    super.initState();
    _setupVideo();
  }

  Future<void> _setupVideo() async {
    final url = widget.esercizio.videoUrl;
    if (url == null) {
      setState(() => _err = 'Nessun video disponibile');
      return;
    }
    try {
      final v = VideoPlayerController.networkUrl(Uri.parse(url));
      await v.initialize();
      final c = ChewieController(
        videoPlayerController: v,
        autoPlay: false,
        looping: true,
        aspectRatio: v.value.aspectRatio,
        materialProgressColors: ChewieProgressColors(
          playedColor: AppTheme.accent,
          handleColor: AppTheme.accent,
          backgroundColor: Colors.grey,
          bufferedColor: AppTheme.accent.withOpacity(0.3),
        ),
      );
      if (!mounted) return;
      setState(() {
        _videoCtrl = v;
        _chewieCtrl = c;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _err = 'Impossibile caricare il video');
    }
  }

  @override
  void dispose() {
    _chewieCtrl?.dispose();
    _videoCtrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ex = widget.esercizio;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(ex.name)),
      body: ListView(
        children: [
          // Video player
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Container(
              color: Colors.black,
              child: _err != null
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.videocam_off, color: Colors.white54, size: 48),
                          const SizedBox(height: 8),
                          Text(_err!, style: const TextStyle(color: Colors.white70)),
                        ],
                      ),
                    )
                  : (_chewieCtrl != null
                      ? Chewie(controller: _chewieCtrl!)
                      : const Center(
                          child: CircularProgressIndicator(color: AppTheme.accent),
                        )),
            ),
          ),

          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(ex.name, style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                )),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    Chip(
                      label: Text(ex.macroGroup),
                      backgroundColor: AppTheme.accent.withOpacity(0.15),
                      side: BorderSide.none,
                      labelStyle: const TextStyle(color: AppTheme.accent),
                    ),
                    Chip(
                      label: Text(ex.eq),
                      backgroundColor: theme.colorScheme.surface,
                    ),
                    Chip(
                      label: Text(ex.muscle),
                      backgroundColor: theme.colorScheme.surface,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                if (ex.media.length > 1) ...[
                  Text('Viste alternative', style: theme.textTheme.titleSmall),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 100,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: ex.media.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (ctx, i) {
                        return Container(
                          width: 100,
                          decoration: BoxDecoration(
                            color: Colors.black,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          alignment: Alignment.center,
                          child: const Icon(Icons.play_circle_outline, color: Colors.white),
                        );
                      },
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

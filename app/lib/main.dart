import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(const NonstopApp());
}

class NonstopApp extends StatelessWidget {
  const NonstopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nonstop',
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo)),
      home: const HomeScreen(),
    );
  }
}

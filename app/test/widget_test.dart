import 'package:flutter_test/flutter_test.dart';

import 'package:nonstop/main.dart';

void main() {
  testWidgets('Home screen renders the Start Voice Chat button', (WidgetTester tester) async {
    await tester.pumpWidget(const NonstopApp());

    expect(find.text('Start Voice Chat'), findsOneWidget);
  });
}

//
//  CharacterCounter.swift
//  Otso
//
//  Character count display
//

import SwiftUI

struct CharacterCounter: View {
    let current: Int
    let limit: Int

    private var remaining: Int {
        limit - current
    }

    private var progress: Double {
        Double(current) / Double(limit)
    }

    private var color: Color {
        if remaining < 0 {
            return .red
        } else if remaining < 20 {
            return .orange
        } else {
            return .secondary
        }
    }

    var body: some View {
        HStack {
            Spacer()

            HStack(spacing: 8) {
                // Progress ring
                ZStack {
                    Circle()
                        .stroke(Color.gray.opacity(0.2), lineWidth: 2)

                    Circle()
                        .trim(from: 0, to: min(progress, 1.0))
                        .stroke(color, lineWidth: 2)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.2), value: progress)
                }
                .frame(width: 16, height: 16)

                // Count text
                Text("\(remaining)")
                    .font(.caption)
                    .foregroundColor(color)
                    .monospacedDigit()
            }
        }
    }
}

#Preview {
    VStack(spacing: 20) {
        CharacterCounter(current: 50, limit: 280)
        CharacterCounter(current: 260, limit: 280)
        CharacterCounter(current: 275, limit: 280)
        CharacterCounter(current: 290, limit: 280)
    }
    .padding()
}
//
//  VisibilityPicker.swift
//  Otso
//
//  Post visibility selector
//

import SwiftUI

struct VisibilityPicker: View {
    @Binding var selection: Visibility

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Visibility")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 0) {
                ForEach(Visibility.allCases, id: \.self) { visibility in
                    VisibilityOption(
                        visibility: visibility,
                        isSelected: selection == visibility,
                        action: { selection = visibility }
                    )
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.secondary.opacity(0.2), lineWidth: 0.5)
            )
        }
    }
}

private struct VisibilityOption: View {
    let visibility: Visibility
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: visibility.icon)
                    .font(.title3)
                Text(visibility.displayName)
                    .font(.caption2)
                    .fontWeight(.medium)
            }
            .foregroundColor(isSelected ? .white : .primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(
                isSelected ? Color.accentColor : Color.clear
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    VisibilityPicker(selection: .constant(.public))
        .padding()
}
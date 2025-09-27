//
//  PostTypeSelector.swift
//  Otso
//
//  Post type selection component
//

import SwiftUI

struct PostTypeSelector: View {
    @Binding var selection: PostType

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(PostType.allCases, id: \.self) { type in
                    PostTypeChip(
                        type: type,
                        isSelected: selection == type,
                        action: { selection = type }
                    )
                }
            }
        }
    }
}

private struct PostTypeChip: View {
    let type: PostType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: type.icon)
                    .font(.caption)
                Text(type.displayName)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(isSelected ? .white : .primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                Group {
                    if isSelected {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.accentColor)
                    } else {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.regularMaterial)
                    }
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.secondary.opacity(0.2), lineWidth: isSelected ? 0 : 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    PostTypeSelector(selection: .constant(.note))
        .padding()
}
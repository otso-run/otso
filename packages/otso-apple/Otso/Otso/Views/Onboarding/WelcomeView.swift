//
//  WelcomeView.swift
//  Otso
//
//  Welcome screen with IndieAuth sign-in
//

import SwiftUI

struct WelcomeView: View {
    @State private var isAnimating = false
    @State private var showingSignIn = false

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [
                    Color.accentColor.opacity(0.1),
                    Color.accentColor.opacity(0.05),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo and branding
                VStack(spacing: 24) {
                    ZStack {
                        // Liquid background effect
                        Circle()
                            .fill(LinearGradient(colors: [.accentColor.opacity(0.3), .accentColor.opacity(0.1)], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 140, height: 140)
                            .blur(radius: 20)
                            .scaleEffect(isAnimating ? 1.2 : 0.9)
                            .animation(
                                .easeInOut(duration: 4)
                                .repeatForever(autoreverses: true),
                                value: isAnimating
                            )

                        Image(systemName: "drop.fill")
                            .font(.system(size: 64, weight: .semibold))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(.tint)
                            .frame(width: 120, height: 120)
                    }

                    VStack(spacing: 8) {
                        Text("Otso")
                            .font(.system(size: 48, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)

                        Text("Your IndieWeb companion")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }
                }

                // Feature highlights
                VStack(spacing: 20) {
                    FeatureRow(
                        icon: "person.crop.circle.badge.checkmark",
                        title: "IndieAuth",
                        description: "Sign in with your own website"
                    )

                    FeatureRow(
                        icon: "square.and.pencil",
                        title: "Compose",
                        description: "Create rich posts with liquid UI"
                    )

                    FeatureRow(
                        icon: "icloud.and.arrow.up",
                        title: "Local-First",
                        description: "Your data, always available offline"
                    )
                }
                .padding(.horizontal, 32)

                Spacer()

                // Sign in button
                Button {
                    showingSignIn = true
                } label: {
                    HStack {
                        Image(systemName: "person.crop.circle.badge.checkmark")
                            .font(.title3)
                        Text("Sign in with IndieAuth")
                            .font(.headline)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        ZStack {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(Color.accentColor)
                        }
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Color.white.opacity(0.2), lineWidth: 0.5)
                    )
                    .shadow(color: Color.accentColor.opacity(0.3), radius: 20, x: 0, y: 10)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 40)
            }
        }
        .sheet(isPresented: $showingSignIn) {
            WebsiteInputView()
        }
        .onAppear {
            isAnimating = true
        }
    }
}

private struct FeatureRow: View {
    let icon: String
    let title: String
    let description: String

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title2)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.tint)
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.primary)

                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
    }
}

#Preview {
    WelcomeView()
}
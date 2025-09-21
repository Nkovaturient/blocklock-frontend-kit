"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Header from "../blocklock/header";
import Footer from "@/components/Footer";

const MediaReleaseLayout = ({ children }: { children: React.ReactNode }) => {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/media-release",
      label: "Create Release",
      description: "Create timed media releases"
    },
    {
      href: "/viewer",
      label: "View Releases",
      description: "Manage existing releases"
    }
  ];

  return (
    <div className="bg-white-pattern min-h-screen">
      <Header />
      
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex space-x-8">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    isActive
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <div className="text-center">
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs text-gray-400 mt-1">{item.description}</div>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main>{children}</main>
      
      <Footer />
    </div>
  );
};

export default MediaReleaseLayout;

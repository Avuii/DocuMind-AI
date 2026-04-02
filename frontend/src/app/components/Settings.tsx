import { Settings as SettingsIcon, User, Bell, Lock, Database, Zap } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";

export function Settings() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-semibold text-slate-900 mb-2 tracking-tight">
          Settings
        </h1>
        <p className="text-lg text-slate-600">
          Manage your account and application preferences
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Settings */}
        <Card className="p-8 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Profile Settings
              </h2>
              <p className="text-sm text-slate-600">
                Update your personal information
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <Label htmlFor="firstName" className="text-slate-700 mb-2 block">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  defaultValue="John"
                  className="bg-white border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <Label htmlFor="lastName" className="text-slate-700 mb-2 block">
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  defaultValue="Doe"
                  className="bg-white border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email" className="text-slate-700 mb-2 block">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                defaultValue="john.doe@company.com"
                className="bg-white border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <Label htmlFor="company" className="text-slate-700 mb-2 block">
                Company Name
              </Label>
              <Input
                id="company"
                defaultValue="Acme Corporation"
                className="bg-white border-slate-300 rounded-lg"
              />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 rounded-xl">
                Save Changes
              </Button>
            </div>
          </div>
        </Card>

        {/* Notification Settings */}
        <Card className="p-8 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Bell className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Notifications
              </h2>
              <p className="text-sm text-slate-600">
                Configure how you receive updates
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  Email Notifications
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Receive email alerts when documents are processed
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  Processing Complete
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Get notified when extraction is complete
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  Failed Extractions
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Alert me when a document fails to process
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  Weekly Summary
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Receive a weekly summary of processed documents
                </p>
              </div>
              <Switch />
            </div>
          </div>
        </Card>

        {/* Processing Settings */}
        <Card className="p-8 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
              <Zap className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Processing
              </h2>
              <p className="text-sm text-slate-600">
                Configure AI extraction behavior
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  Auto-process Uploads
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Automatically start extraction on upload
                </p>
              </div>
              <Switch defaultChecked />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-slate-900 font-medium">
                  High Accuracy Mode
                </Label>
                <p className="text-sm text-slate-600 mt-1">
                  Use enhanced AI models for better accuracy (slower)
                </p>
              </div>
              <Switch />
            </div>

            <Separator className="bg-slate-200" />

            <div>
              <Label className="text-slate-900 font-medium mb-2 block">
                Confidence Threshold
              </Label>
              <p className="text-sm text-slate-600 mb-4">
                Minimum confidence score to accept extracted values
              </p>
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  defaultValue="85"
                  className="w-24 bg-white border-slate-300 rounded-lg"
                />
                <span className="text-sm text-slate-600">%</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Security Settings */}
        <Card className="p-8 border-slate-200 shadow-sm bg-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <Lock className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Security
              </h2>
              <p className="text-sm text-slate-600">
                Manage your password and security preferences
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <Label htmlFor="currentPassword" className="text-slate-700 mb-2 block">
                Current Password
              </Label>
              <Input
                id="currentPassword"
                type="password"
                className="bg-white border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <Label htmlFor="newPassword" className="text-slate-700 mb-2 block">
                New Password
              </Label>
              <Input
                id="newPassword"
                type="password"
                className="bg-white border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <Label htmlFor="confirmPassword" className="text-slate-700 mb-2 block">
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                className="bg-white border-slate-300 rounded-lg"
              />
            </div>

            <Separator className="bg-slate-200" />

            <div className="flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 rounded-xl">
                Update Password
              </Button>
            </div>
          </div>
        </Card>

        {/* Data Management */}
        <Card className="p-8 border-red-200 bg-gradient-to-br from-red-50 to-white shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
              <Database className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Data Management
              </h2>
              <p className="text-sm text-slate-600">
                Manage your stored documents and data
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Button
              variant="outline"
              className="w-full justify-start border-slate-300 hover:bg-white rounded-xl"
            >
              <Database className="w-4 h-4 mr-2" />
              Download All Data
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 rounded-xl"
            >
              <Database className="w-4 h-4 mr-2" />
              Delete All Documents
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

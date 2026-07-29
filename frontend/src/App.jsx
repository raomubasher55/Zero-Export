import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Rocket, Server, Palette, Zap } from 'lucide-react';

function App() {
  const [apiStatus, setApiStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => res.json())
      .then((data) => {
        setApiStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('API Error:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Zero Export</h1>
          </div>
          <Badge variant="secondary">v1.0.0</Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Hero Section */}
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-bold tracking-tight">
              Full Stack Ready 🚀
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              React + Vite frontend with Tailwind CSS & Radix UI, powered by a Node.js Express backend.
              Everything runs concurrently with a single command.
            </p>
          </div>

          <Separator />

          {/* API Status Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Backend Connection
              </CardTitle>
              <CardDescription>
                Status of the connection to the Express API server
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-sm text-muted-foreground">Connecting to API...</span>
                </div>
              ) : apiStatus ? (
                <div className="flex items-center gap-3">
                  <Badge variant="default" className="bg-green-600">Connected</Badge>
                  <span className="text-sm font-mono text-muted-foreground">
                    "{apiStatus.message}"
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Badge variant="destructive">Disconnected</Badge>
                  <span className="text-sm text-muted-foreground">
                    Make sure the backend is running on port 3001
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Features Tabs */}
          <Tabs defaultValue="frontend" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="frontend">Frontend</TabsTrigger>
              <TabsTrigger value="backend">Backend</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
            </TabsList>

            <TabsContent value="frontend" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    Frontend Stack
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <TechItem name="React 18" desc="UI library with hooks & concurrent features" />
                  <TechItem name="Vite 6" desc="Lightning fast dev server & HMR" />
                  <TechItem name="Tailwind CSS v4" desc="Utility-first CSS with new engine" />
                  <TechItem name="Radix UI" desc="Accessible, unstyled UI primitives" />
                  <TechItem name="Lucide Icons" desc="Beautiful & consistent icon set" />
                  <TechItem name="CVA + clsx" desc="Type-safe variant management" />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="backend" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    Backend Stack
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <TechItem name="Express.js" desc="Fast, unopinionated web framework" />
                  <TechItem name="CORS" desc="Cross-origin resource sharing" />
                  <TechItem name="Helmet" desc="Security headers middleware" />
                  <TechItem name="Morgan" desc="HTTP request logger" />
                  <TechItem name="dotenv" desc="Environment variable management" />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="setup" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    Quick Start
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted p-4 font-mono text-sm space-y-1">
                    <p className="text-muted-foreground"># Install all dependencies</p>
                    <p>npm run install:all</p>
                    <p className="text-muted-foreground pt-2"># Start both servers</p>
                    <p>npm run dev</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Frontend runs on <code className="bg-muted px-1 rounded">localhost:5173</code> and
                    Backend on <code className="bg-muted px-1 rounded">localhost:3001</code>.
                    API requests are proxied automatically via Vite.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function TechItem({ name, desc }) {
  return (
    <div className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
      <div className="h-2 w-2 rounded-full bg-primary mt-2 shrink-0" />
      <div>
        <span className="font-medium text-sm">{name}</span>
        <span className="text-sm text-muted-foreground ml-2">— {desc}</span>
      </div>
    </div>
  );
}

export default App;

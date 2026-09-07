
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto prose prose-invert prose-primary">
          <h1 className="font-headline">Privacy Policy</h1>
          <p className="text-muted-foreground">Last updated: May 20, 2024</p>
          
          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">1. Introduction</h2>
            <p className="text-muted-foreground">ClipGrab respects your privacy. This policy describes how we handle information when you use our video downloading service.</p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">2. Information We DO NOT Collect</h2>
            <p className="text-muted-foreground">
              Unlike other tools, ClipGrab does not require registration. We do not collect your name, email address, or any personal identity information.
            </p>
            <ul className="list-disc pl-6 text-muted-foreground">
              <li>No user accounts or passwords.</li>
              <li>No browsing history logs.</li>
              <li>No permanent storage of the links you paste.</li>
            </ul>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">3. Temporary File Storage</h2>
            <p className="text-muted-foreground">
              When you request a download, our servers temporarily process the media file. These files are stored in a secured cache and are automatically permanently deleted 15 minutes after they are generated.
            </p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">4. Third-Party Platforms</h2>
            <p className="text-muted-foreground">
              ClipGrab interacts with third-party sites (YouTube, Instagram, etc.) to fetch content. Your use of those platforms is governed by their respective privacy policies.
            </p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">5. Contact</h2>
            <p className="text-muted-foreground">
              If you have questions about this policy, please reach out to us at privacy@clipgrab.app.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}

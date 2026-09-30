
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"

export default function TermsOfService() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow pt-32 pb-20 px-4">
        <div className="max-w-3xl mx-auto prose prose-invert prose-primary">
          <h1 className="font-headline">Terms of Service</h1>
          <p className="text-muted-foreground">Last updated: May 20, 2024</p>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">1. Usage Agreement</h2>
            <p className="text-muted-foreground">
              By using ClipGrab, you agree to these terms. ClipGrab is provided "as is" and is intended for personal, non-commercial use only.
            </p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">2. Copyright and IP</h2>
            <p className="text-muted-foreground">
              Users are solely responsible for respecting the copyright and intellectual property rights of the content owners. You should only download content that you have the legal right to access or for which you have received permission from the owner.
            </p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">3. Prohibited Use</h2>
            <p className="text-muted-foreground">You agree not to use ClipGrab for:</p>
            <ul className="list-disc pl-6 text-muted-foreground">
              <li>Bulk downloading or scraping of entire channels.</li>
              <li>Circumventing digital rights management (DRM) technologies.</li>
              <li>Redistributing downloaded content for commercial gain without permission.</li>
            </ul>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">4. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              ClipGrab is a technical tool that functions as a pass-through service. We do not host any content on our servers permanently and are not liable for how users utilize the downloaded files.
            </p>
          </section>

          <section className="space-y-4 mt-8">
            <h2 className="font-headline text-2xl font-bold">5. Changes to Terms</h2>
            <p className="text-muted-foreground">
              We reserve the right to modify these terms at any time. Continued use of the service constitutes acceptance of the new terms.
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}

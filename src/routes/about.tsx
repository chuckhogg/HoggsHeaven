import { createFileRoute } from "@tanstack/react-router";
import { LOGO_URL, reviews } from "@/lib/catalog";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/about")({ component: AboutPage });

function AboutPage() {
  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4 text-lg">
          <p className="text-xs font-semibold uppercase tracking-widest text-barn">About us</p>
          <h1 className="text-4xl">Hogg's Heaven Farm</h1>
          <p>Chuck and Angela Hogg started the farm on a five-acre plot in Shelby County, Kentucky. The land began as a family playground. By 2018 Angela and Hannah were adding chicks and ducklings, and by 2019 they were searching for rare breeds that were hard to find in Kentucky.</p>
          <p>In 2020 the farm added two Bulgarian Shepherds, Athena and Apollo. Their first litter arrived in 2022. Demand grew with them: customers drive in from hours away, and hatching eggs now ship.</p>
          <p>It is still a husband-and-wife team, focused on healthy birds that represent the breed. The flock includes Ayam Cemani, American Bresse, Black Copper Marans, French Wheaten Marans, Gold Deathlayers, and Pita Pintas.</p>
        </div>
        <aside className="rounded-card border border-line bg-paper p-5">
          <img src={LOGO_URL} alt="Hogg's Heaven Farm" className="h-24 w-auto max-w-full object-contain" />
          <h2 className="mt-4 text-2xl">Visit</h2>
          <p className="mt-2 text-muted">
            Shelbyville, Kentucky 40065
            <br />
            Message ahead for a farm visit.
            <br />
            <a className="text-barn" href="tel:+15024356649">502-435-6649</a>
            <br />
            <a className="text-barn" href="mailto:chuckhogg@gmail.com">chuckhogg@gmail.com</a>
          </p>
          <p className="mt-3">
            <a className="font-semibold text-barn" href="https://www.facebook.com/hoggsheaven" target="_blank" rel="noreferrer">Facebook</a>
          </p>
        </aside>
      </div>
      <div className="mt-10 grid gap-3 md:grid-cols-2">
        {reviews.map((review) => (
          <article key={review.name + review.date} className="rounded-card border border-line bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-barn">Recommends</p>
            <p className="mt-2">&ldquo;{review.text}&rdquo;</p>
            <p className="mt-3 font-semibold">{review.name}</p>
            <p className="text-sm text-muted">{review.date}</p>
          </article>
        ))}
      </div>
    </Shell>
  );
}

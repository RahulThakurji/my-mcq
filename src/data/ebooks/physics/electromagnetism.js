export const electromagnetism = {
  title: "Electrostatics & Gauss's Law",
  bookTitle: "Electromagnetism",
  content: [
    {
      type: "h2",
      text: "Introduction to Electrostatics"
    },
    {
      type: "p",
      text: "Electrostatics is the study of electromagnetic phenomena that occur when there are no moving charges—i.e., after a static equilibrium has been established. The fundamental law of electrostatics is $\\text{Coulomb's Law}$."
    },
    {
      type: "h3",
      text: "Coulomb's Law"
    },
    {
      type: "p",
      text: "The force between two point charges $q_1$ and $q_2$ is directly proportional to the product of the magnitude of charges and inversely proportional to the square of the distance $r$ between them: $$F = k \\frac{|q_1 q_2|}{r^2}$$ where $k$ is the electrostatic constant, $k \\approx 8.99 \\times 10^9 \\text{ N}\\cdot\\text{m}^2/\\text{C}^2$."
    },
    {
      type: "h3",
      text: "Electric Field"
    },
    {
      type: "p",
      text: "The electric field $\\vec{E}$ at a point in space is defined as the force per unit charge: $$\\vec{E} = \\frac{\\vec{F}}{q}$$ For a point charge $Q$, the magnitude of the electric field at distance $r$ is: $$E = \\frac{1}{4\\pi\\epsilon_0} \\frac{Q}{r^2}$$"
    },
    {
      type: "h2",
      text: "Gauss's Law"
    },
    {
      type: "p",
      text: "Gauss's law relates the net electric flux through a closed surface to the net enclosed charge. It is one of Maxwell's four equations."
    },
    {
      type: "p",
      text: "The integral form of Gauss's law is: $$\\oint_S \\vec{E} \\cdot d\\vec{A} = \\frac{Q_{\\text{enc}}}{\\epsilon_0}$$ where $\\Phi_E$ is the electric flux, and $\\epsilon_0$ is the vacuum permittivity ($8.854 \\times 10^{-12} \\text{ F/m}$)."
    },
    {
      type: "h3",
      text: "Applications of Gauss's Law"
    },
    {
      type: "list",
      items: [
        "Field due to an infinitely long straight wire: $E = \\frac{\\lambda}{2\\pi\\epsilon_0 r}$",
        "Field due to an uniformly charged infinite plane sheet: $E = \\frac{\\sigma}{2\\epsilon_0}$",
        "Field inside a conducting sphere: $E = 0$ (for $r < R$)"
      ]
    }
  ]
};
